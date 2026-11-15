import { WsolaStretcher } from './wsola.js';

/** Drift readings averaged before any soft correction (30 ticks = 1.5 s). */
const DRIFT_WINDOW = 30;

export class AudioEngine {
  constructor({
    win,
    speed,
    leadS = 0.4,
    chunkS = 0.1,
    extraDelayMs = 0,
    onError,
    createStretcher
  }) {
    this.win = win;
    this.speed = speed;
    this.leadS = leadS;
    this.chunkS = chunkS;
    this.extraDelayMs = extraDelayMs;
    this.onError = onError;
    this.createStretcher =
      createStretcher ||
      (({ sampleRate, channels, speed: _speed }) =>
        new WsolaStretcher({
          sampleRate,
          channels,
          searchStep: 2,
          corrStep: 2
        }));

    this.ctx = new win.AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);

    this.chunks = [];
    this.pcm = [];

    this.video = null;
    this.decoder = null;
    this.cfg = null;
    this.decodeGen = 0;
    this.sentToDecoder = new Set();
    this.failed = false;

    this.stretcher = null;
    this.stretcherRate = null;
    this.stretcherChannels = null;

    this.nextWhen = 0;
    this.inPos = 0;

    this.sources = new Set();

    this.volume = 1;
    this.muted = false;

    this.lastVideoTime = -1;
    this.anchorPending = false;

    this.tickInterval = this.win.setInterval(() => this.tick(), 50);

    this.onPause = () => {
      // Pause must be silent at once: stop everything, including the buffer
      // that is playing right now, and re-anchor on the next real movement.
      this.stopFuture();
      this.stretcher = null;
      this.anchorPending = false;
    };
    this.onSeeking = () => {
      this.stopFuture();
      this.stretcher = null;
      this.anchorPending = false;
      this.decodeGen++;
      this.sentToDecoder.clear();
      if (this.decoder && this.decoder.state === 'configured') {
        this.decoder.reset();
        this.decoder.configure(this.cfg);
      }
    };
    this.onPlaying = () => {
      this.lastVideoTime = this.video.currentTime;
      this.anchorPending = true;
    };
  }

  attachVideo(el) {
    this.video = el;
    this.video.addEventListener('pause', this.onPause);
    this.video.addEventListener('seeking', this.onSeeking);
    this.video.addEventListener('playing', this.onPlaying);
    this.lastVideoTime = this.video.currentTime;
    if (!this.video.paused) this.anchorPending = true;
  }

  setVolume(v, muted) {
    this.volume = v;
    this.muted = muted;
    this.gain.gain.value = muted ? 0 : v;
  }

  configure(cfg) {
    if (this.cfg && this.isSameCfg(this.cfg, cfg)) {
      return;
    }
    this.cfg = cfg;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.win.AudioDecoder.isConfigSupported(cfg)
      .then((res) => {
        // A newer configure() may have arrived while this check was pending:
        // only the latest configuration gets a decoder.
        if (this.cfg !== cfg || this.destroyed) return;
        if (!res.supported) {
          this.reportError(
            Object.assign(new Error('Not supported'), {
              name: 'NotSupportedError'
            })
          );
          return;
        }
        this.decoder = new this.win.AudioDecoder({
          output: (data) => this.onAudioData(data),
          error: (e) => this.reportError(e)
        });
        this.decoder.configure(cfg);
        this.decodeGen++;
        this.sentToDecoder.clear();
        this.pumpDecoder();
      })
      .catch((e) => this.reportError(e));
  }

  isSameCfg(c1, c2) {
    if (!c1 || !c2) return false;
    if (
      c1.codec !== c2.codec ||
      c1.sampleRate !== c2.sampleRate ||
      c1.numberOfChannels !== c2.numberOfChannels
    )
      return false;
    if (
      (c1.description && !c2.description) ||
      (!c1.description && c2.description)
    )
      return false;
    if (c1.description) {
      if (c1.description.byteLength !== c2.description.byteLength) return false;
      for (let i = 0; i < c1.description.byteLength; i++) {
        if (c1.description[i] !== c2.description[i]) return false;
      }
    }
    return true;
  }

  push(chunks) {
    if (this.failed) return;
    for (const c of chunks) {
      const ptsUs = Math.round(c.pts * 1e6);
      const durUs = Math.round(c.duration * 1e6);
      const eac = new this.win.EncodedAudioChunk({
        type: c.key ? 'key' : 'delta',
        timestamp: ptsUs,
        duration: durUs,
        data: c.data
      });
      // Sorted insert with binary search: YouTube keeps minutes of audio in the
      // archive, and a linear search + full sort per append grows quadratically.
      const entry = { pts: ptsUs, chunk: eac, dur: durUs };
      const i = this.lowerBound(ptsUs);
      if (i < this.chunks.length && this.chunks[i].pts === ptsUs)
        this.chunks[i] = entry;
      else this.chunks.splice(i, 0, entry);
    }
    this.pumpDecoder();
  }

  /** Index of the first archived chunk with pts >= ptsUs. */
  lowerBound(ptsUs) {
    let lo = 0;
    let hi = this.chunks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.chunks[mid].pts < ptsUs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  discard(a, b) {
    // Audio already queued for WebAudio may carry the discarded content: stop it
    // and re-anchor, the anchor then skips the hole.
    if (this.stretcher && !this.anchorPending) {
      const queuedFrom =
        this.outContent -
        Math.max(0, this.nextWhen - this.ctx.currentTime) * this.speed;
      if (a < this.outContent && b > queuedFrom) {
        this.stopFuture();
        this.stretcher = null;
        this.anchorPending = true;
      }
    }
    const aUs = Math.round(a * 1e6);
    const bUs = Math.round(b * 1e6);
    this.chunks = this.chunks.filter((c) => {
      const cEnd = c.pts + c.dur;
      return !(cEnd > aUs && c.pts < bUs);
    });
    this.pcm = this.pcm.flatMap((p) => {
      const pEnd = p.t + p.n / p.rate;
      if (p.t >= b || pEnd <= a) return [p];
      const pieces = [];
      if (p.t < a) {
        const nBefore = Math.floor((a - p.t) * p.rate);
        if (nBefore > 0) {
          const chBefore = p.ch.map((c) => c.slice(0, nBefore));
          pieces.push({ t: p.t, n: nBefore, rate: p.rate, ch: chBefore });
        }
      }
      if (pEnd > b) {
        const nAfter = Math.floor((pEnd - b) * p.rate);
        const startIdx = p.n - nAfter;
        if (nAfter > 0) {
          const chAfter = p.ch.map((c) => c.slice(startIdx));
          pieces.push({
            t: p.t + startIdx / p.rate,
            n: nAfter,
            rate: p.rate,
            ch: chAfter
          });
        }
      }
      return pieces;
    });
  }

  reset() {
    this.stopFuture();
    this.stretcher = null;
    this.anchorPending = !!this.video && !this.video.paused;
    this.chunks = [];
    this.pcm = [];
    this.sentToDecoder.clear();
    this.decodeGen++;
    if (this.decoder && this.decoder.state === 'configured') {
      this.decoder.reset();
      this.decoder.configure(this.cfg);
    }
  }

  destroy() {
    this.destroyed = true;
    this.win.clearInterval(this.tickInterval);
    if (this.video) {
      this.video.removeEventListener('pause', this.onPause);
      this.video.removeEventListener('seeking', this.onSeeking);
      this.video.removeEventListener('playing', this.onPlaying);
    }
    this.stopFuture();
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    if (this.ctx.state !== 'closed') this.ctx.close();
  }

  reportError(e) {
    if (this.failed) return;
    this.failed = true;
    if (this.onError) {
      this.onError(e);
    }
  }

  onAudioData(data) {
    if (this.failed) {
      data.close();
      return;
    }
    const t = data.timestamp / 1e6;
    const rate = data.sampleRate;
    const n = data.numberOfFrames;
    const chs = [];
    for (let i = 0; i < data.numberOfChannels; i++) {
      const buf = new Float32Array(n);
      data.copyTo(buf, { planeIndex: i, format: 'f32-planar' });
      chs.push(buf);
    }
    data.close();

    this.pcm.push({ t, n, rate, ch: chs });
    this.pcm.sort((a, b) => a.t - b.t);
  }

  pumpDecoder() {
    if (!this.decoder || this.decoder.state !== 'configured' || this.failed)
      return;
    if (!this.video) return;

    const currT = this.video.currentTime;
    const endT = currT + 3;

    const currUs = Math.round(currT * 1e6);
    const endUs = Math.round(endT * 1e6);

    for (
      let i = this.lowerBound(currUs - 100000);
      i < this.chunks.length;
      i++
    ) {
      const c = this.chunks[i];
      if (c.pts > endUs) break;
      const key = `${this.decodeGen}:${c.pts}`;
      if (!this.sentToDecoder.has(key)) {
        this.sentToDecoder.add(key);
        this.decoder.decode(c.chunk);
      }
    }
  }

  stopFuture() {
    const nowCtx = this.ctx.currentTime;
    for (const s of this.sources) {
      try {
        s.node.stop(nowCtx);
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
  }

  tick() {
    if (this.failed || !this.video) return;
    this.prunePcm(
      Math.min(this.video.currentTime, this.stretcher ? this.inPos : Infinity) -
        2
    );
    this.pumpDecoder();

    const nowCtx = this.ctx.currentTime;
    const currT = this.video.currentTime;

    if (this.video.paused) {
      this.lastVideoTime = currT;
      return;
    }

    if (this.anchorPending && currT !== this.lastVideoTime) {
      this.anchorPending = false;
      this.nextWhen = nowCtx + 0.03;
      this.outContent = currT + (this.nextWhen - nowCtx) * this.speed;
      this.inPos = this.outContent;
      this.stretcher = null;
    }
    this.lastVideoTime = currT;

    if (this.anchorPending) return;

    const predictedT = currT + (this.nextWhen - nowCtx) * this.speed;
    const drift = this.outContent - predictedT;
    const starving = this.nextWhen <= nowCtx;

    // The TV's audio clock advances in steps (measured on an LG OLED C4, webOS 24): a single
    // drift reading saw-tooths by ±60 ms (period ~200 ms, mean ~0) even when
    // audio and video are aligned. Reacting to single readings stopped and
    // restarted all queued audio about every 200 ms, and a short median still
    // made soft corrections chase the noise (+34/-34 ms back and forth). So:
    // - a real jump (seek without events, stall) is one reading beyond 500 ms, or
    //   two in a row beyond 250 ms on the same side (the noise stays under ~90 ms):
    //   hard resync;
    // - otherwise only the MEAN of ~1.5 s of readings counts, at most one soft
    //   correction every 1.5 s, and only 70% of it (damped, never oscillating).
    this.drifts = this.drifts || [];
    this.drifts.push(drift);
    if (this.drifts.length > DRIFT_WINDOW) this.drifts.shift();
    const last2 = this.drifts.slice(-2);
    const jumped =
      Math.abs(drift) > 0.5 ||
      (last2.length === 2 &&
        last2.every((d) => Math.abs(d) > 0.25) &&
        last2[0] * last2[1] > 0);

    if (jumped || starving) {
      this.stopFuture();
      this.sources.clear();
      this.nextWhen = nowCtx + 0.03;
      this.outContent = currT + (this.nextWhen - nowCtx) * this.speed;
      this.inPos = this.outContent;
      this.stretcher = null;
      this.drifts = [];
      this.lastSoftFix = nowCtx;
    } else if (
      this.stretcher &&
      this.drifts.length >= DRIFT_WINDOW &&
      nowCtx - (this.lastSoftFix || 0) >= 1.5
    ) {
      const mean = this.drifts.reduce((a, b) => a + b, 0) / this.drifts.length;
      if (Math.abs(mean) > 0.045) {
        this.softCorrect(0.7 * mean);
        this.lastSoftFix = nowCtx;
        this.drifts = [];
      }
    }

    while (this.nextWhen < nowCtx + this.leadS) {
      if (!this.stretcher) {
        let blockIdx = this.pcm.findIndex(
          (p) =>
            p.t <= this.inPos + 0.002 && p.t + p.n / p.rate > this.inPos - 0.002
        );
        if (blockIdx === -1) {
          blockIdx = this.pcm.findIndex((p) => p.t > this.inPos);
          if (blockIdx === -1) break;
          const p = this.pcm[blockIdx];
          if (p.t - this.inPos > 0.1) break;
          this.inPos = p.t;
        }
        const b = this.pcm[blockIdx];
        this.stretcherRate = b.rate;
        this.stretcherChannels = b.ch.length;
        this.stretcher = this.createStretcher({
          sampleRate: b.rate,
          channels: b.ch.length,
          speed: this.speed
        });
        this.stretcher.setSpeed(this.speed);
      }

      const pcmToPush = this.extractPcm(this.inPos, this.chunkS * this.speed);
      if (!pcmToPush || pcmToPush.ch[0].length === 0) {
        break;
      }

      this.stretcher.push(pcmToPush.ch);
      this.inPos += pcmToPush.ch[0].length / this.stretcherRate;

      const avail = this.stretcher.available();
      if (avail > 0) {
        const toPull = Math.min(
          avail,
          Math.floor(this.chunkS * this.stretcherRate)
        );
        const pulled = this.stretcher.pull(toPull);
        if (pulled && pulled[0] && pulled[0].length > 0) {
          const len = pulled[0].length;
          const buf = this.ctx.createBuffer(
            this.stretcherChannels,
            len,
            this.stretcherRate
          );
          for (let c = 0; c < this.stretcherChannels; c++) {
            buf.copyToChannel(pulled[c], c);
          }

          const node = this.ctx.createBufferSource();
          node.buffer = buf;
          node.connect(this.gain);
          node.start(this.nextWhen);

          const srcInfo = {
            node,
            when: this.nextWhen,
            dur: len / this.stretcherRate
          };
          this.sources.add(srcInfo);
          node.onended = () => this.sources.delete(srcInfo);

          this.nextWhen += len / this.stretcherRate;
          this.outContent += (len / this.stretcherRate) * this.speed;
        }
      }
    }
  }

  /**
   * Drops decoded audio well behind the playhead. It can always be decoded
   * again from the compressed archive (a seek bumps the decode generation), and
   * keeping it would grow by ~350 KB per second of stereo 44.1 kHz audio.
   */
  prunePcm(beforeT) {
    if (
      !this.pcm.length ||
      this.pcm[0].t + this.pcm[0].n / this.pcm[0].rate >= beforeT
    )
      return;
    this.pcm = this.pcm.filter((p) => p.t + p.n / p.rate >= beforeT);
    // Chunks whose audio was dropped must be decodable again if we come back.
    const cut = Math.round(beforeT * 1e6);
    for (const key of this.sentToDecoder) {
      const pts = Number(key.slice(key.indexOf(':') + 1));
      if (pts < cut) this.sentToDecoder.delete(key);
    }
  }

  /**
   * Small drift correction that never stops queued audio.
   * Audio ahead of the video: leave a gap of drift/S seconds before the next
   * buffer. Audio behind: drop that much stretched output (a few ms of sound).
   */
  softCorrect(drift) {
    if (drift > 0) {
      this.nextWhen += drift / this.speed;
      return;
    }
    const want = Math.round((-drift / this.speed) * this.stretcherRate);
    const n = Math.min(want, this.stretcher.available());
    if (n > 0) {
      this.stretcher.pull(n);
      this.outContent += (n / this.stretcherRate) * this.speed;
    }
    // Not enough output ready yet: skip the rest in the input instead.
    const rest = ((want - n) / this.stretcherRate) * this.speed;
    if (rest > 0) {
      this.inPos += rest;
      this.outContent += rest;
    }
  }

  extractPcm(startT, duration) {
    let requiredLen = Math.floor(duration * this.stretcherRate);
    let extracted = Array.from(
      { length: this.stretcherChannels },
      () => new Float32Array(requiredLen)
    );
    let written = 0;

    let currT = startT;
    for (const p of this.pcm) {
      if (written >= requiredLen) break;
      const pEndT = p.t + p.n / p.rate;
      if (pEndT < currT - 0.002) continue;
      if (p.t > currT + 0.002) {
        break;
      }
      const startIdx = Math.max(0, Math.round((currT - p.t) * p.rate));
      const rem = requiredLen - written;
      const toWrite = Math.min(rem, p.n - startIdx);
      if (toWrite <= 0) continue;

      for (let c = 0; c < this.stretcherChannels; c++) {
        extracted[c].set(
          p.ch[c].subarray(startIdx, startIdx + toWrite),
          written
        );
      }
      written += toWrite;
      currT += toWrite / p.rate;
    }

    if (written === 0) return null;
    if (written < requiredLen) {
      for (let c = 0; c < this.stretcherChannels; c++) {
        extracted[c] = extracted[c].subarray(0, written);
      }
    }
    return { ch: extracted };
  }
}
