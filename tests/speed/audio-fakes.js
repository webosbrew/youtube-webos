// Strict fakes for the AudioEngine contract tests: they model the real Web
// APIs, not the engine.
//
// - One fake clock drives AudioContext.currentTime, the timers and the video.
// - The fake AudioDecoder emits AudioData whose samples ENCODE their own content
//   time: channel 0 = K * t, channel 1 = -K * t (t = content seconds). So any
//   scheduled AudioBuffer tells, by its first sample, which content it plays.
// - The fake <video> knows which content it shows at any context time, so a test
//   can check "the audio scheduled at `when` is the content the video shows at
//   `when`" — the real definition of A/V sync.
// - ExactStretcher is a deterministic time-stretcher with an exact input/output
//   mapping (output sample k = input sample round(k * S)): injected through
//   `createStretcher`, it lets tests reason about content times exactly.

export const K = 0.01; // ramp slope: sample value = K * content seconds

class Event {
  constructor(type) {
    this.type = type;
  }
}

class EventTarget {
  constructor() {
    this._l = {};
  }
  addEventListener(t, f) {
    (this._l[t] ||= []).push(f);
  }
  removeEventListener(t, f) {
    this._l[t] = (this._l[t] || []).filter((x) => x !== f);
  }
  dispatchEvent(e) {
    if (!(e instanceof Event))
      throw new TypeError("parameter 1 is not of type 'Event'");
    for (const f of [...(this._l[e.type] || [])]) f.call(this, e);
    return true;
  }
  listenerCount() {
    return Object.values(this._l).reduce((n, a) => n + a.length, 0);
  }
}

const domError = (name, msg) => Object.assign(new Error(msg || name), { name });

export function makeWorld({
  speed = 1.5,
  decodedRate = null,
  decodeDelayMs = 0,
  shuffle = 0,
  unsupported = false,
  ctxRate = 48000,
  ctxQuantumMs = 0
} = {}) {
  const world = {
    speed,
    now: 0,
    intervals: new Map(),
    timeouts: [],
    nextId: 1,
    sources: [],
    contexts: [],
    decoders: [],
    errors: [],
    seed: 12345
  };
  const rnd = () => {
    world.seed = (world.seed * 1103515245 + 12345) & 0x7fffffff;
    return world.seed / 0x7fffffff;
  };

  class AudioBuffer {
    constructor(ch, length, sampleRate) {
      if (!(length > 0))
        throw domError('NotSupportedError', 'length must be > 0');
      if (!(sampleRate >= 8000 && sampleRate <= 96000))
        throw domError('NotSupportedError', 'bad sampleRate');
      this.numberOfChannels = ch;
      this.length = length;
      this.sampleRate = sampleRate;
      this.duration = length / sampleRate;
      this._d = Array.from({ length: ch }, () => new Float32Array(length));
    }
    getChannelData(c) {
      if (c < 0 || c >= this.numberOfChannels) throw domError('IndexSizeError');
      return this._d[c];
    }
    copyToChannel(src, c, off = 0) {
      this.getChannelData(c).set(src, off);
    }
  }

  class AudioBufferSourceNode {
    constructor(ctx) {
      this.context = ctx;
      this.buffer = null;
      this._started = false;
      this.stopTime = null;
    }
    connect(node) {
      this.connectedTo = node;
      return node;
    }
    disconnect() {
      this.connectedTo = null;
    }
    start(when = 0) {
      if (this._started)
        throw domError('InvalidStateError', 'start called twice');
      if (!this.buffer) throw domError('InvalidStateError', 'no buffer');
      this._started = true;
      this.when = Math.max(when, this.context.currentTime);
      this.lateBy = Math.max(0, this.context.currentTime - when);
      const b = this.buffer;
      world.sources.push({
        node: this,
        when: this.when,
        dur: b.duration,
        rate: b.sampleRate,
        length: b.length,
        content: b.getChannelData(0)[0] / K,
        contentEnd: b.getChannelData(0)[b.length - 1] / K,
        ch0: b.getChannelData(0),
        ch1: b.numberOfChannels > 1 ? b.getChannelData(1) : null,
        expected: world.video ? world.video.contentAt(this.when) : null,
        scheduledAt: this.context.currentTime
      });
    }
    stop(when = 0) {
      if (!this._started)
        throw domError('InvalidStateError', 'stop before start');
      const t = Math.max(when, this.context.currentTime);
      this.stopTime = this.stopTime === null ? t : Math.min(this.stopTime, t);
    }
  }

  class AudioContext {
    constructor() {
      this.sampleRate = ctxRate;
      this.state = 'running';
      this.destination = { kind: 'destination' };
      world.contexts.push(this);
    }
    // ctxQuantumMs > 0 reproduces the LG TV (measured on an OLED C4, webOS 24):
    // currentTime advances in coarse steps, so any drift computed from it
    // saw-tooths by tens of milliseconds (mean ~0) even when audio and video
    // are aligned.
    get currentTime() {
      return ctxQuantumMs
        ? Math.round(world.now / (ctxQuantumMs / 1000)) * (ctxQuantumMs / 1000)
        : world.now;
    }
    createGain() {
      return {
        gain: { value: 1 },
        connect(n) {
          return n;
        },
        disconnect() {}
      };
    }
    createBuffer(ch, len, sr) {
      return new AudioBuffer(ch, len, sr);
    }
    createBufferSource() {
      return new AudioBufferSourceNode(this);
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
  }

  class EncodedAudioChunk {
    constructor({ type, timestamp, duration, data }) {
      if (type !== 'key' && type !== 'delta') throw new TypeError('bad type');
      // Stricter than the browser (which truncates): the engine must hand over
      // integer microseconds it computed on purpose, not a truncation accident.
      if (!Number.isInteger(timestamp))
        throw new TypeError('timestamp must be integer microseconds');
      if (duration !== undefined && !Number.isInteger(duration))
        throw new TypeError('duration must be integer microseconds');
      this.type = type;
      this.timestamp = timestamp;
      this.duration = duration;
      this.byteLength = data.byteLength;
      this._data = data;
    }
  }

  class AudioData {
    constructor(ts, frames, channels, rate) {
      this.timestamp = ts;
      this.numberOfFrames = frames;
      this.numberOfChannels = channels;
      this.sampleRate = rate;
      this.format = 'f32-planar';
      this.duration = Math.round((frames / rate) * 1e6);
      this._closed = false;
    }
    copyTo(dest, { planeIndex, format } = {}) {
      if (this._closed) throw domError('InvalidStateError', 'AudioData closed');
      if (format && format !== 'f32-planar')
        throw domError('NotSupportedError', 'format');
      if (planeIndex < 0 || planeIndex >= this.numberOfChannels)
        throw new RangeError('planeIndex');
      if (dest.length < this.numberOfFrames)
        throw new RangeError('dest too small');
      const t0 = this.timestamp / 1e6;
      const sign = planeIndex === 0 ? 1 : -1;
      for (let j = 0; j < this.numberOfFrames; j++)
        dest[j] = sign * K * (t0 + j / this.sampleRate);
    }
    close() {
      this._closed = true;
    }
  }

  class AudioDecoder {
    constructor({ output, error }) {
      if (typeof output !== 'function' || typeof error !== 'function')
        throw new TypeError('init');
      this._out = output;
      this._err = error;
      this.state = 'unconfigured';
      this._pending = [];
      world.decoders.push(this);
    }
    static isConfigSupported(cfg) {
      return Promise.resolve({
        supported: !unsupported && cfg.codec !== 'ec-3',
        config: cfg
      });
    }
    get decodeQueueSize() {
      return this._pending.length;
    }
    configure(cfg) {
      if (this.state === 'closed') throw domError('InvalidStateError');
      this.state = 'configured';
      this._cfg = cfg;
    }
    decode(chunk) {
      if (this.state !== 'configured')
        throw domError('InvalidStateError', 'decode while ' + this.state);
      if (!(chunk instanceof EncodedAudioChunk))
        throw new TypeError('not an EncodedAudioChunk');
      const rate = decodedRate || this._cfg.sampleRate;
      const frames = Math.round((chunk.duration / 1e6) * rate);
      const job = { chunk, rate, frames };
      this._pending.push(job);
      const delay = decodeDelayMs + (shuffle ? rnd() * shuffle : 0);
      world.setTimeout(() => this._emit(job), delay);
    }
    _emit(job) {
      if (this.state !== 'configured') return;
      const i = this._pending.indexOf(job);
      if (i < 0) return;
      this._pending.splice(i, 1);
      this._out(
        new AudioData(
          job.chunk.timestamp,
          job.frames,
          this._cfg.numberOfChannels,
          job.rate
        )
      );
    }
    flush() {
      if (this.state !== 'configured')
        return Promise.reject(domError('InvalidStateError'));
      const jobs = [...this._pending];
      jobs
        .sort((a, b) => a.chunk.timestamp - b.chunk.timestamp)
        .forEach((j) => {
          this._emit(j);
        });
      return Promise.resolve();
    }
    reset() {
      this._pending = [];
      this.state = 'unconfigured';
    }
    close() {
      this._pending = [];
      this.state = 'closed';
    }
    fail(msg = 'decode failed') {
      this.state = 'closed';
      this._err(domError('EncodingError', msg));
    }
  }

  world.setTimeout = (fn, ms) => {
    const id = world.nextId++;
    world.timeouts.push({ id, at: world.now + ms / 1000, fn });
    return id;
  };
  world.clearTimeout = (id) => {
    world.timeouts = world.timeouts.filter((t) => t.id !== id);
  };
  world.setInterval = (fn, ms) => {
    const id = world.nextId++;
    world.intervals.set(id, {
      fn,
      every: ms / 1000,
      next: world.now + ms / 1000
    });
    return id;
  };
  world.clearInterval = (id) => {
    world.intervals.delete(id);
  };

  world.win = {
    AudioContext,
    AudioDecoder,
    EncodedAudioChunk,
    Event,
    EventTarget,
    setTimeout: world.setTimeout,
    clearTimeout: world.clearTimeout,
    setInterval: world.setInterval,
    clearInterval: world.clearInterval
  };

  const flush = () => new Promise((r) => setImmediate(r));

  // Advance the shared clock in 5 ms steps, firing due timers and letting
  // promise callbacks run in between (the decoder resolves through promises).
  // Every await below is deliberate: timers and intervals must fire and settle
  // in clock order, one 5 ms tick at a time.
  world.advance = async (ms, onStep) => {
    const end = world.now + ms / 1000;
    while (world.now < end - 1e-9) {
      world.now = Math.min(end, world.now + 0.005);
      for (const t of world.timeouts.filter((t) => t.at <= world.now + 1e-9)) {
        world.timeouts = world.timeouts.filter((x) => x !== t);
        t.fn();
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }
      for (const [id, iv] of [...world.intervals]) {
        if (world.intervals.has(id) && iv.next <= world.now + 1e-9) {
          iv.next += iv.every;
          iv.fn();
          // eslint-disable-next-line no-await-in-loop
          await flush();
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await flush();
      if (onStep) onStep();
    }
  };
  world.flush = flush;

  // The video shows content `c0 + (ctx - t0) * S * rateFactor` once moving.
  class FakeVideo extends EventTarget {
    constructor() {
      super();
      this.paused = true;
      this._c0 = 0;
      this._t0 = 0;
      this._moveAt = Infinity;
      this.rateFactor = 1;
      world.video = this;
    }
    contentAt(ctxTime) {
      if (this.paused || ctxTime < this._moveAt) return this._c0;
      return (
        this._c0 + (ctxTime - this._moveAt) * world.speed * this.rateFactor
      );
    }
    get currentTime() {
      return this.contentAt(world.now);
    }
    set currentTime(v) {
      this.seek(v);
    }
    // play(): 'playing' fires now, frames only move after `startLatencyMs`
    // (measured ~380 ms on the TV in the proof of concept).
    play(startLatencyMs = 380) {
      this._c0 = this.currentTime;
      this.paused = false;
      this._moveAt = world.now + startLatencyMs / 1000;
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
    }
    pause() {
      this._c0 = this.currentTime;
      this.paused = true;
      this._moveAt = Infinity;
      this.dispatchEvent(new Event('pause'));
    }
    seek(c, startLatencyMs = 200) {
      this.dispatchEvent(new Event('seeking'));
      this._c0 = c;
      if (!this.paused) this._moveAt = world.now + startLatencyMs / 1000;
      this.dispatchEvent(new Event('seeked'));
      if (!this.paused) this.dispatchEvent(new Event('playing'));
    }
    // A silent discontinuity: no event at all (e.g. a stall the engine must notice).
    jump(dc) {
      const c = this.currentTime + dc;
      this._c0 = c;
      if (!this.paused) this._moveAt = world.now;
    }
  }
  world.FakeVideo = FakeVideo;
  return world;
}

// Deterministic stretcher: output sample k (since the last reset) is input
// sample round(k * S). Same interface as WsolaStretcher.
export class ExactStretcher {
  constructor({ channels }) {
    this.channels = channels;
    this.speed = 1;
    this.reset();
  }
  setSpeed(s) {
    this.speed = s;
  }
  reset() {
    this._in = Array.from({ length: this.channels }, () => []);
    this._k = 0;
    this._base = 0;
  }
  push(chs) {
    for (let c = 0; c < this.channels; c++)
      for (const v of chs[c]) this._in[c].push(v);
  }
  available() {
    const inLen = this._in[0].length + this._base;
    return Math.max(0, Math.floor((inLen - 1) / this.speed) - this._k + 1);
  }
  pull(n) {
    const m = Math.min(n, this.available());
    const out = Array.from(
      { length: this.channels },
      () => new Float32Array(m)
    );
    for (let j = 0; j < m; j++) {
      const idx = Math.round((this._k + j) * this.speed) - this._base;
      for (let c = 0; c < this.channels; c++) out[c][j] = this._in[c][idx];
    }
    this._k += m;
    const drop = Math.max(0, Math.round(this._k * this.speed) - this._base - 4);
    if (drop > 0) {
      for (let c = 0; c < this.channels; c++) this._in[c].splice(0, drop);
      this._base += drop;
    }
    return out;
  }
  flush() {}
}

// AAC-like chunks: `frames` samples at `rate`, contiguous pts (content seconds).
export function chunks(fromS, toS, { rate = 44100, frames = 1024 } = {}) {
  const out = [];
  const d = frames / rate;
  for (let t = fromS; t < toS - 1e-9; t += d)
    out.push({ pts: t, duration: d, data: new Uint8Array(8), key: true });
  return out;
}

export const aacCfg = {
  codec: 'mp4a.40.2',
  sampleRate: 44100,
  numberOfChannels: 2,
  description: new Uint8Array([0x12, 0x10])
};
export const opusCfg = {
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 2,
  description: new Uint8Array(19)
};

// Sources that actually produce sound: started and not stopped before they begin.
export const audible = (world) =>
  world.sources.filter(
    (s) => s.node.stopTime === null || s.node.stopTime > s.when + 1e-6
  );
export const effEnd = (s) =>
  Math.min(s.when + s.dur, s.node.stopTime ?? Infinity);
