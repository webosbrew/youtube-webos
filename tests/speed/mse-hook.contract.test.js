// Contract tests for mse-hook.js: the element shim, the fake MediaSource/
// SourceBuffer session lifecycle, and how init/media segments are handled for
// both video (rewritten in place) and audio (demuxed into a sink). They use
// their OWN strict fakes, closer to the DOM than tests/speed/fakes.js:
// dispatchEvent only accepts real Event instances, the video element is wired
// through `src = URL.createObjectURL(ms)` like YouTube does, and the real
// SpeedTimeMap is used.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installMseHook } from '../../src/speed/mse-hook.js';
import { attachElementShim } from '../../src/speed/element-shim.js';
import { SpeedTimeMap } from '../../src/speed/timemap.js';
import { parseBoxes } from '../../src/speed/isobmff.js';
import {
  audioConfigFromWebmInit,
  demuxClusters
} from '../../src/speed/webm.js';

const dir = new URL('./fixtures/', import.meta.url);
const load = (n) => new Uint8Array(readFileSync(new URL(n, dir)));
const tick = () => new Promise((r) => setTimeout(r, 0));
const MP4V = 'video/mp4; codecs="avc1.4d401f"';

function strictWindow() {
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
      for (const f of this._l[e.type] || []) f.call(this, e);
      return true;
    }
  }
  const ranges = (arr) => ({
    length: arr.length,
    start(i) {
      if (i < 0 || i >= arr.length) throw new RangeError('index');
      return arr[i][0];
    },
    end(i) {
      if (i < 0 || i >= arr.length) throw new RangeError('index');
      return arr[i][1];
    }
  });
  class SourceBuffer extends EventTarget {
    constructor() {
      super();
      this.appended = [];
      this.removed = [];
      this._ts = 0;
      this._aws = 0;
      this._awe = Infinity;
      this._ranges = [];
      this.updating = false;
    }
    appendBuffer(d) {
      const v =
        d instanceof ArrayBuffer
          ? new Uint8Array(d)
          : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      this.appended.push(v.slice());
      this.updating = true;
      queueMicrotask(() => {
        this.updating = false;
        this.dispatchEvent(new Event('updateend'));
      });
    }
    remove(s, e) {
      this.removed.push([s, e]);
    }
  }
  for (const [p, f] of [
    ['timestampOffset', '_ts'],
    ['appendWindowStart', '_aws'],
    ['appendWindowEnd', '_awe']
  ]) {
    Object.defineProperty(SourceBuffer.prototype, p, {
      get() {
        return this[f];
      },
      set(v) {
        this[f] = v;
      },
      configurable: true
    });
  }
  Object.defineProperty(SourceBuffer.prototype, 'buffered', {
    get() {
      return ranges(this._ranges);
    },
    configurable: true
  });
  class MediaSource extends EventTarget {
    constructor() {
      super();
      this._sbs = [];
      this._d = NaN;
    }
    addSourceBuffer() {
      const sb = new SourceBuffer();
      this._sbs.push(sb);
      return sb;
    }
    get sourceBuffers() {
      const l = [...this._sbs];
      l.item = (i) => l[i];
      return l;
    }
  }
  Object.defineProperty(MediaSource.prototype, 'duration', {
    get() {
      return this._d;
    },
    set(v) {
      this._d = v;
    },
    configurable: true
  });
  class HTMLMediaElement extends EventTarget {
    constructor() {
      super();
      this._src = '';
      this._ct = 0;
      this._dur = NaN;
      this._rate = 1;
      this._buf = [];
    }
  }
  const acc = (p, f, ro) =>
    Object.defineProperty(HTMLMediaElement.prototype, p, {
      get() {
        return this[f];
      },
      set: ro
        ? undefined
        : function (v) {
            this[f] = v;
          },
      configurable: true
    });
  acc('src', '_src');
  acc('currentTime', '_ct');
  acc('duration', '_dur', true);
  acc('playbackRate', '_rate');
  Object.defineProperty(HTMLMediaElement.prototype, 'buffered', {
    get() {
      return ranges(this._buf);
    },
    configurable: true
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'seekable', {
    get() {
      return ranges(this._buf);
    },
    configurable: true
  });
  let n = 0;
  const URL = {
    createObjectURL() {
      return `blob:fake/${++n}`;
    },
    revokeObjectURL() {}
  };
  return {
    Event,
    EventTarget,
    SourceBuffer,
    MediaSource,
    HTMLMediaElement,
    URL,
    ranges,
    document: { createElement: () => new HTMLMediaElement() }
  };
}

function recorderSink() {
  const s = { configs: [], samples: [], discards: [], resets: 0 };
  return Object.assign(s, {
    configure(c) {
      s.configs.push(c);
    },
    push(x) {
      s.samples.push(...x);
    },
    discard(a, b) {
      s.discards.push([a, b]);
    },
    reset() {
      s.resets++;
    }
  });
}

function setup(speed = 1.5) {
  const win = strictWindow();
  const sink = recorderSink();
  const rates = [];
  const errors = [];
  const hook = installMseHook(win, {
    getSpeed: () => speed,
    createAudioSink: () => sink,
    onRateRequest: (r) => rates.push(r),
    onError: (e) => errors.push(e)
  });
  return { win, sink, rates, errors, hook };
}

const timescaleOf = (u8) => {
  const i = Buffer.from(u8).indexOf('mdhd');
  const v = u8[i + 4];
  return new DataView(u8.buffer, u8.byteOffset).getUint32(
    i + 4 + 4 + (v === 1 ? 16 : 8)
  );
};
const initOf = (u8) =>
  u8.subarray(
    0,
    parseBoxes(u8, 0, u8.length).find((b) => b.type === 'moov').end
  );

describe('element shim with the real SpeedTimeMap', () => {
  test('setting currentTime maps content -> element time', () => {
    const win = strictWindow();
    const el = win.document.createElement('video');
    const shim = attachElementShim(el, new SpeedTimeMap(1.5), {
      onRateRequest() {}
    });
    el.currentTime = 9;
    assert.equal(el._ct, 6);
    shim.detach();
  });
});

describe('wiring through src = createObjectURL(ms)', () => {
  test('the element bound to a 1.5x session speaks content time', async () => {
    const { win, rates } = setup(1.5);
    const ms = new win.MediaSource();
    const el = win.document.createElement('video');
    el.src = win.URL.createObjectURL(ms);
    ms.addSourceBuffer(MP4V); // the session is born after src, as on sourceopen
    el._ct = 4;
    assert.equal(el.currentTime, 6);
    el._dur = 20;
    assert.equal(el.duration, 30);
    assert.equal(el.playbackRate, 1.5);
    el.playbackRate = 2;
    assert.deepEqual(rates, [2]);
    assert.equal(el._rate, 1, 'hardware rate untouched');
    el.src = 'https://example.com/other.mp4';
    assert.equal(
      el.currentTime,
      4,
      'shim detached when src leaves the session'
    );
  });

  test('at speed 1 the element is left alone', () => {
    const { win } = setup(1);
    const ms = new win.MediaSource();
    const el = win.document.createElement('video');
    el.src = win.URL.createObjectURL(ms);
    ms.addSourceBuffer(MP4V);
    assert.deepEqual(
      Object.getOwnPropertyNames(el).filter((p) => !p.startsWith('_')),
      []
    );
  });
});

describe('session lifecycle', () => {
  test('assigning the same session URL twice does not stack the shim (x1.5, not x2.25)', () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const el = win.document.createElement('video');
    const url = win.URL.createObjectURL(ms);
    el.src = url;
    ms.addSourceBuffer(MP4V);
    el.src = url;
    el._ct = 4;
    assert.equal(el.currentTime, 6);
  });

  test('the speed is decided once per MediaSource (1.5 then 1 -> audio still fake)', () => {
    const win = strictWindow();
    const speeds = [1.5, 1];
    installMseHook(win, {
      getSpeed: () => speeds.shift() ?? 1,
      createAudioSink: recorderSink,
      onRateRequest() {},
      onError() {}
    });
    const ms = new win.MediaSource();
    ms.addSourceBuffer(MP4V);
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    assert.equal(ms._sbs.length, 1, 'only the video SourceBuffer is real');
  });

  test('the speed is decided once per MediaSource (1 then 1.5 -> no session at all)', () => {
    const win = strictWindow();
    const speeds = [1, 1.5];
    installMseHook(win, {
      getSpeed: () => speeds.shift() ?? 1.5,
      createAudioSink: recorderSink,
      onRateRequest() {},
      onError() {}
    });
    const ms = new win.MediaSource();
    const v = ms.addSourceBuffer(MP4V);
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    assert.equal(ms._sbs.length, 2, 'both SourceBuffers are real');
    assert.deepEqual(
      Object.getOwnPropertyNames(v).filter(
        (p) =>
          !p.startsWith('_') && !['appended', 'removed', 'updating'].includes(p)
      ),
      []
    );
  });

  test('uninstall restores createObjectURL and the src descriptor', () => {
    const win = strictWindow();
    const origURL = win.URL.createObjectURL;
    const origSrc = Object.getOwnPropertyDescriptor(
      win.HTMLMediaElement.prototype,
      'src'
    );
    const origAdd = win.MediaSource.prototype.addSourceBuffer;
    const { uninstall } = installMseHook(win, {
      getSpeed: () => 1.5,
      createAudioSink: recorderSink,
      onRateRequest() {},
      onError() {}
    });
    uninstall();
    assert.equal(win.URL.createObjectURL, origURL);
    assert.equal(win.MediaSource.prototype.addSourceBuffer, origAdd);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'src'),
      origSrc
    );
  });
});

describe('video SourceBuffer', () => {
  test('every init segment is rewritten, not only the first (quality switches)', () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer(MP4V);
    const real = ms._sbs[0];
    const yt136 = load('yt_136.bin');
    const yt398 = load('yt_398.bin');
    sb.appendBuffer(yt136);
    real.updating = false;
    sb.appendBuffer(initOf(yt398)); // switch to another representation
    assert.equal(timescaleOf(real.appended[0]), 18432);
    assert.equal(timescaleOf(real.appended[1]), 18432);
  });

  test('every appendBuffer reaches the real SourceBuffer (no withheld bytes = no stall)', () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('video/webm; codecs="vp9"');
    const real = ms._sbs[0];
    const yt247 = load('yt_247.bin');
    sb.appendBuffer(yt247.subarray(0, 60)); // a chunk too small to hold the whole init
    assert.equal(real.appended.length, 1);
    assert.equal(real.appended[0].length, 60);
  });

  test('a subarray view is forwarded with exactly its own bytes', () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer(MP4V);
    const real = ms._sbs[0];
    const yt136 = load('yt_136.bin');
    sb.appendBuffer(yt136);
    const view = yt136.subarray(yt136.length - 100, yt136.length);
    sb.appendBuffer(view);
    assert.deepEqual([...real.appended[1]], [...view]);
  });

  test('an init that cannot be rewritten (truncated moov) reports onError and passes through', () => {
    const { win, errors } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer(MP4V);
    const yt136 = load('yt_136.bin');
    const chunk = yt136.subarray(0, 60); // ftyp + the start of moov
    sb.appendBuffer(chunk);
    assert.equal(ms._sbs[0].appended[0].length, 60);
    assert.equal(errors.length, 1);
  });

  test('a WebM init cut before TimecodeScale reports onError and passes through', () => {
    const { win, errors } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('video/webm; codecs="vp9"');
    sb.appendBuffer(load('yt_247.bin').subarray(0, 60));
    assert.equal(ms._sbs[0].appended[0].length, 60);
    assert.equal(errors.length, 1);
  });
});

describe('fake audio SourceBuffer', () => {
  test('events are real Event objects and InvalidStateError has the DOM name', async () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    const seen = [];
    sb.addEventListener('updateend', (e) => seen.push(e));
    sb.appendBuffer(load('yt_140.bin'));
    assert.throws(() => sb.appendBuffer(new Uint8Array(4)), {
      name: 'InvalidStateError'
    });
    await tick();
    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof win.Event);
  });

  test('unsupported audio codec (ec-3) reports onError and still ends the update', async () => {
    const { win, errors } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="ec-3"');
    const init = initOf(load('yt_140.bin')).slice();
    const i = Buffer.from(init).indexOf('mp4a');
    init.set([0x65, 0x63, 0x2d, 0x33], i); // 'ec-3'
    let ended = 0;
    sb.addEventListener('updateend', () => ended++);
    sb.appendBuffer(init);
    await tick();
    assert.equal(ended, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, 'NotSupportedError');
  });

  test('WebM audio: pts are finite and shifted by timestampOffset', async () => {
    const { win, sink } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/webm; codecs="opus"');
    const yt251 = load('yt_251.bin');
    sb.timestampOffset = 5;
    sb.appendBuffer(yt251);
    await tick();
    const cfg = audioConfigFromWebmInit(yt251);
    const ref = demuxClusters(yt251, {
      timecodeScale: 1000000,
      trackNumber: cfg.trackNumber
    }).frames;
    assert.ok(sink.samples.length > 0);
    assert.equal(sink.samples.length, ref.length);
    assert.ok(sink.samples.every((s) => Number.isFinite(s.pts)));
    assert.ok(Math.abs(sink.samples[0].pts - (ref[0].pts + 5)) < 1e-9);
    assert.ok(Number.isFinite(sb.buffered.end(0)));
  });

  test('remove() shrinks buffered and discards in the sink', async () => {
    const { win, sink } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    sb.appendBuffer(load('yt_140.bin'));
    await tick();
    const end = sb.buffered.end(0);
    sb.remove(0, 5);
    await tick();
    assert.deepEqual(sink.discards, [[0, 5]]);
    assert.ok(
      sb.buffered.length === 1 &&
        sb.buffered.start(0) >= 5 - 1e-6 &&
        sb.buffered.end(0) === end
    );
  });

  test('buffered keeps separate ranges after a jump (seek)', async () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    const yt140 = load('yt_140.bin');
    const boxes = parseBoxes(yt140, 0, yt140.length);
    const moofs = boxes.filter((b) => b.type === 'moof');
    sb.appendBuffer(yt140.subarray(0, moofs[1].start)); // init + fragment 1
    await tick();
    sb.timestampOffset = 100; // YouTube jumps ahead
    sb.appendBuffer(yt140.subarray(moofs[1].start, moofs[2].start)); // fragment 2
    await tick();
    assert.equal(sb.buffered.length, 2);
  });

  test('changeType from mp4 to webm starts from a fresh init', async () => {
    const { win, sink } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    sb.appendBuffer(load('yt_140.bin'));
    await tick();
    const before = sink.samples.length;
    sb.changeType('audio/webm; codecs="opus"');
    sb.appendBuffer(load('yt_251.bin'));
    await tick();
    assert.equal(sink.configs.at(-1).codec, 'opus');
    const after = sink.samples.slice(before);
    assert.ok(after.length > 0 && after.every((s) => Number.isFinite(s.pts)));
  });

  test('abort during an update fires abort then updateend and clears updating', () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    const order = [];
    sb.addEventListener('abort', () => order.push('abort'));
    sb.addEventListener('updateend', () => order.push('updateend'));
    sb.appendBuffer(load('yt_140.bin'));
    sb.abort();
    assert.equal(sb.updating, false);
    assert.deepEqual(order, ['abort', 'updateend']);
  });

  test('abort does not produce a second updateend later', async () => {
    const { win } = setup(1.5);
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    let ended = 0;
    sb.addEventListener('updateend', () => ended++);
    sb.appendBuffer(load('yt_140.bin'));
    sb.abort();
    await tick();
    assert.equal(ended, 1);
  });

  test('no debug console.log left in the hook', () => {
    const src = readFileSync(
      new URL('../../src/speed/mse-hook.js', import.meta.url),
      'utf8'
    );
    assert.ok(!/console\.log/.test(src));
  });
});
