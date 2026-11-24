/**
 * WebCodecs AudioDecoder stand-in for browsers that do not have it (webOS 6 and
 * older, Chromium <= 87). It exposes the small subset of the AudioDecoder /
 * EncodedAudioChunk / AudioData API that audio-engine.js uses.
 *
 * Encoded frames are batched, wrapped in a container that decodeAudioData()
 * understands (ADTS for AAC, Ogg for Opus) and decoded on an
 * OfflineAudioContext at the stream's own sample rate, so nothing is resampled.
 * Each batch is prefixed with a few frames that precede it (pre-roll), whose
 * output is dropped: AAC and Opus frames overlap their neighbours, so a batch
 * decoded cold would click at every seam.
 */

const PREROLL = { aac: 3, opus: 16 };
const FIRST_BATCH_US = 300000;
const BATCH_US = 1000000;
const MIN_BATCH_US = 500000;
const MAX_WAIT_MS = 400;
const HISTORY = 64;
const CONTIGUOUS_TOL_US = 2000;
const MAX_CONSECUTIVE_FAILURES = 3;

export class LegacyEncodedAudioChunk {
  constructor({ type, timestamp, duration, data }) {
    this.type = type;
    this.timestamp = timestamp;
    this.duration = duration || 0;
    const u8 =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(
            data.buffer || data,
            data.byteOffset || 0,
            data.byteLength
          );
    // Copy: the caller may reuse or transfer its buffer.
    this.data = new Uint8Array(u8);
    this.byteLength = this.data.byteLength;
  }
}

class LegacyAudioData {
  constructor(timestamp, sampleRate, channels) {
    this.timestamp = timestamp;
    this.sampleRate = sampleRate;
    this.numberOfChannels = channels.length;
    this.numberOfFrames = channels.length ? channels[0].length : 0;
    this.format = 'f32-planar';
    this.duration = Math.round((this.numberOfFrames / sampleRate) * 1e6);
    this.channels = channels;
  }

  copyTo(dest, { planeIndex = 0 } = {}) {
    dest.set(this.channels[planeIndex].subarray(0, dest.length));
  }

  close() {
    this.channels = null;
  }
}

function codecFamily(codec) {
  if (typeof codec !== 'string') return null;
  if (codec.startsWith('mp4a.40.')) return 'aac';
  if (codec === 'opus') return 'opus';
  return null;
}

/* ---------------------------------------------------------------- AAC/ADTS */

function adtsParams(cfg) {
  const asc = cfg.description;
  let aot = 2;
  let freqIdx;
  let chanCfg = cfg.numberOfChannels || 2;
  if (asc && asc.length >= 2) {
    aot = asc[0] >> 3;
    freqIdx = ((asc[0] & 7) << 1) | (asc[1] >> 7);
    chanCfg = (asc[1] >> 3) & 0xf;
  }
  if (freqIdx === undefined) {
    const rates = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000,
      11025, 8000, 7350
    ];
    freqIdx = rates.indexOf(cfg.sampleRate);
  }
  if (freqIdx < 0 || freqIdx > 12) return null;
  // HE-AAC (SBR/PS) is carried as AAC-LC in ADTS; the decoder detects SBR.
  const profile = aot >= 1 && aot <= 4 ? aot - 1 : 1;
  return { profile, freqIdx, chanCfg };
}

function buildAdts(params, frames) {
  let total = 0;
  for (const f of frames) total += f.data.length + 7;
  const out = new Uint8Array(total);
  let o = 0;
  for (const f of frames) {
    const len = f.data.length + 7;
    out[o] = 0xff;
    out[o + 1] = 0xf1;
    out[o + 2] =
      (params.profile << 6) | (params.freqIdx << 2) | (params.chanCfg >> 2);
    out[o + 3] = ((params.chanCfg & 3) << 6) | (len >> 11);
    out[o + 4] = (len >> 3) & 0xff;
    out[o + 5] = ((len & 7) << 5) | 0x1f;
    out[o + 6] = 0xfc;
    out.set(f.data, o + 7);
    o += len;
  }
  return out;
}

/* ---------------------------------------------------------------- Opus/Ogg */

let crcTable = null;
function oggCrc(u8) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++)
        r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      crcTable[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (let i = 0; i < u8.length; i++) {
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ u8[i]) & 0xff]) >>> 0;
  }
  return crc;
}

function oggPage(packets, granule, seq, flags) {
  const lacing = [];
  let bodyLen = 0;
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
    bodyLen += p.length;
  }
  const page = new Uint8Array(27 + lacing.length + bodyLen);
  const dv = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  page[4] = 0;
  page[5] = flags;
  dv.setUint32(6, granule >>> 0, true);
  dv.setUint32(10, Math.floor(granule / 4294967296), true);
  dv.setUint32(14, 0x5954, true); // serial
  dv.setUint32(18, seq, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, o);
    o += p.length;
  }
  dv.setUint32(22, oggCrc(page), true);
  return page;
}

function opusHead(cfg) {
  const d = cfg.description;
  let head;
  if (
    d &&
    d.length >= 19 &&
    String.fromCharCode(...d.subarray(0, 8)) === 'OpusHead'
  ) {
    head = new Uint8Array(d);
  } else {
    head = new Uint8Array(19);
    head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);
    head[8] = 1;
    head[9] = cfg.numberOfChannels || 2;
    new DataView(head.buffer).setUint32(12, 48000, true);
  }
  // Pre-skip 0: the batch is trimmed here, by its known durations.
  head[10] = 0;
  head[11] = 0;
  return head;
}

const OPUS_TAGS = (() => {
  const vendor = [0x79, 0x74, 0x61, 0x66]; // "ytaf"
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  t.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0);
  new DataView(t.buffer).setUint32(8, vendor.length, true);
  t.set(vendor, 12);
  return t;
})();

function buildOgg(head, frames) {
  const pages = [oggPage([head], 0, 0, 0x02), oggPage([OPUS_TAGS], 0, 1, 0)];
  let seq = 2;
  let granule = 0;
  let pending = [];
  let lacingCount = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const segs = Math.floor(f.data.length / 255) + 1;
    if (lacingCount + segs > 255 && pending.length) {
      pages.push(oggPage(pending, granule, seq++, 0));
      pending = [];
      lacingCount = 0;
    }
    pending.push(f.data);
    lacingCount += segs;
    granule += Math.round((f.duration / 1e6) * 48000);
  }
  pages.push(oggPage(pending, granule, seq, 0x04));
  let total = 0;
  for (const p of pages) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of pages) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ------------------------------------------------------------- the decoder */

export function createLegacyAudioDecoderClass(win) {
  const OfflineCtx = win.OfflineAudioContext || win.webkitOfflineAudioContext;

  class LegacyAudioDecoder {
    static isConfigSupported(cfg) {
      const fam = codecFamily(cfg && cfg.codec);
      let supported = !!OfflineCtx && !!fam;
      if (supported && fam === 'aac') supported = adtsParams(cfg) !== null;
      return Promise.resolve({ supported, config: cfg });
    }

    constructor({ output, error }) {
      this.output = output;
      this.error = error;
      this.state = 'unconfigured';
      this.gen = 0;
      this.queue = [];
      this.history = [];
      this.chain = Promise.resolve();
      this.flushTimer = null;
      this.flushDelay = 0;
      this.queueUs = 0;
      this.failures = 0;
      this.firstBatch = true;
    }

    configure(cfg) {
      if (this.state === 'closed') throw new Error('InvalidStateError');
      this.cfg = cfg;
      this.family = codecFamily(cfg.codec);
      this.rate = this.family === 'opus' ? 48000 : cfg.sampleRate;
      this.channels = cfg.numberOfChannels || 2;
      this.adts = this.family === 'aac' ? adtsParams(cfg) : null;
      this.head = this.family === 'opus' ? opusHead(cfg) : null;
      this.state = 'configured';
      this.firstBatch = true;
    }

    decode(chunk) {
      if (this.state !== 'configured') throw new Error('InvalidStateError');
      this.queue.push(chunk);
      this.queueUs += chunk.duration;
      // The engine feeds ~50 ms at a time, 3 s ahead of playback. Decoding each
      // trickle on its own would repeat the pre-roll for every few frames, so
      // wait for MIN_BATCH_US (or MAX_WAIT_MS), except right after a (re)start.
      if (this.firstBatch || this.queueUs >= MIN_BATCH_US)
        this.scheduleFlush(0);
      else this.scheduleFlush(MAX_WAIT_MS);
    }

    scheduleFlush(ms) {
      if (this.flushTimer !== null) {
        if (ms >= this.flushDelay) return;
        win.clearTimeout(this.flushTimer);
      }
      this.flushDelay = ms;
      this.flushTimer = win.setTimeout(() => {
        this.flushTimer = null;
        this.flushQueue();
      }, ms);
    }

    cancelFlush() {
      if (this.flushTimer !== null) win.clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.queue = [];
      this.queueUs = 0;
    }

    reset() {
      if (this.state === 'closed') throw new Error('InvalidStateError');
      this.gen++;
      this.cancelFlush();
      this.state = 'unconfigured';
    }

    close() {
      this.gen++;
      this.cancelFlush();
      this.history = [];
      this.state = 'closed';
    }

    remember(chunk) {
      const h = this.history;
      let i = h.length;
      while (i > 0 && h[i - 1].timestamp > chunk.timestamp) i--;
      if (i > 0 && h[i - 1].timestamp === chunk.timestamp) return;
      h.splice(i, 0, chunk);
      if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
    }

    prerollFor(first) {
      const want = PREROLL[this.family];
      const out = [];
      let next = first;
      for (let i = this.history.length - 1; i >= 0 && out.length < want; i--) {
        const c = this.history[i];
        if (c.timestamp >= next.timestamp) continue;
        if (
          Math.abs(c.timestamp + c.duration - next.timestamp) >
          CONTIGUOUS_TOL_US
        )
          break;
        out.unshift(c);
        next = c;
      }
      return out;
    }

    flushQueue() {
      if (this.state !== 'configured' || !this.queue.length) return;
      const q = this.queue.sort((a, b) => a.timestamp - b.timestamp);
      this.queue = [];
      this.queueUs = 0;
      let batch = [];
      let batchUs = 0;
      const emit = () => {
        if (batch.length) this.enqueueBatch(batch);
        batch = [];
        batchUs = 0;
      };
      for (const c of q) {
        const prev = batch[batch.length - 1];
        const limit = this.firstBatch ? FIRST_BATCH_US : BATCH_US;
        if (
          prev &&
          (Math.abs(prev.timestamp + prev.duration - c.timestamp) >
            CONTIGUOUS_TOL_US ||
            batchUs >= limit)
        ) {
          emit();
          this.firstBatch = false;
        }
        batch.push(c);
        batchUs += c.duration;
      }
      emit();
      this.firstBatch = false;
    }

    enqueueBatch(batch) {
      const gen = this.gen;
      const preroll = this.prerollFor(batch[0]);
      for (const c of batch) this.remember(c);
      this.chain = this.chain
        .then(() =>
          gen === this.gen ? this.decodeBatch(preroll, batch, gen) : null
        )
        .catch((e) => this.fail(e));
    }

    decodeBatch(preroll, batch, gen) {
      const frames = preroll.concat(batch);
      const bytes =
        this.family === 'aac'
          ? buildAdts(this.adts, frames)
          : buildOgg(this.head, frames);
      const ctx = new OfflineCtx(this.channels, 1, this.rate);
      const prerollUs = preroll.reduce((s, c) => s + c.duration, 0);
      const batchUs = batch.reduce((s, c) => s + c.duration, 0);
      return new Promise((resolve, reject) => {
        // Callback form: Chromium 79 also returns a promise, older ones do not.
        const p = ctx.decodeAudioData(bytes.buffer, resolve, reject);
        if (p && typeof p.catch === 'function') p.catch(reject);
      }).then(
        (buf) => {
          if (gen !== this.gen) return;
          this.failures = 0;
          const rate = buf.sampleRate;
          const start = Math.min(
            buf.length,
            Math.round((prerollUs / 1e6) * rate)
          );
          const len = Math.min(
            buf.length - start,
            Math.round((batchUs / 1e6) * rate)
          );
          const chs = [];
          for (let c = 0; c < buf.numberOfChannels; c++) {
            chs.push(buf.getChannelData(c).slice(start, start + len));
          }
          this.output(new LegacyAudioData(batch[0].timestamp, rate, chs));
        },
        (e) => {
          if (gen !== this.gen) return;
          this.failures++;
          if (this.failures >= MAX_CONSECUTIVE_FAILURES)
            throw e || new Error('decode failed');
          // Keep the timeline continuous with silence for this batch.
          const len = Math.round((batchUs / 1e6) * this.rate);
          const chs = [];
          for (let c = 0; c < this.channels; c++)
            chs.push(new Float32Array(len));
          this.output(new LegacyAudioData(batch[0].timestamp, this.rate, chs));
        }
      );
    }

    fail(e) {
      if (this.state === 'closed') return;
      this.state = 'closed';
      if (this.error) this.error(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return LegacyAudioDecoder;
}

/** The WebCodecs classes the audio engine uses: native when present. */
export function getAudioCodecs(win) {
  if (
    typeof win.AudioDecoder === 'function' &&
    typeof win.EncodedAudioChunk === 'function'
  ) {
    return {
      AudioDecoder: win.AudioDecoder,
      EncodedAudioChunk: win.EncodedAudioChunk,
      legacy: false
    };
  }
  if (!win.__ytafLegacyAudioDecoder) {
    win.__ytafLegacyAudioDecoder = createLegacyAudioDecoderClass(win);
  }
  return {
    AudioDecoder: win.__ytafLegacyAudioDecoder,
    EncodedAudioChunk: LegacyEncodedAudioChunk,
    legacy: true
  };
}

export function hasAudioCodecs(win) {
  return (
    (typeof win.AudioDecoder === 'function' &&
      typeof win.EncodedAudioChunk === 'function') ||
    typeof (win.OfflineAudioContext || win.webkitOfflineAudioContext) ===
      'function'
  );
}
