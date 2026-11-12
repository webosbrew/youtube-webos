// DOM-like fakes shared by the controller wiring tests.

export function fakePlayer({ videoId = 'abc123', t = 123.4 } = {}) {
  const calls = [];
  return {
    calls,
    getVideoData: () => ({ video_id: videoId }),
    getCurrentTime: () => t,
    loadVideoById: (id, start) => calls.push(['loadVideoById', id, start]),
    setPlaybackQualityRange: (a, b) =>
      calls.push(['setPlaybackQualityRange', a, b])
  };
}

// A small DOM-like window for the wiring test: MediaSource + <video> + document.
export function domWindow(world, { withAudio = true } = {}) {
  const { EventTarget } = world.win;
  class SourceBuffer extends EventTarget {
    appendBuffer() {}
    remove() {}
  }
  for (const p of ['timestampOffset', 'appendWindowStart', 'appendWindowEnd']) {
    Object.defineProperty(SourceBuffer.prototype, p, {
      get() {
        return this['_' + p] || 0;
      },
      set(v) {
        this['_' + p] = v;
      },
      configurable: true
    });
  }
  Object.defineProperty(SourceBuffer.prototype, 'buffered', {
    get() {
      return {
        length: 0,
        start() {
          throw new RangeError();
        },
        end() {
          throw new RangeError();
        }
      };
    },
    configurable: true
  });
  class MediaSource extends EventTarget {
    constructor() {
      super();
      this._sbs = [];
    }
    addSourceBuffer() {
      const s = new SourceBuffer();
      this._sbs.push(s);
      return s;
    }
    get sourceBuffers() {
      return this._sbs;
    }
  }
  Object.defineProperty(MediaSource.prototype, 'duration', {
    get() {
      return this._d ?? NaN;
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
      this.volume = 1;
      this.muted = false;
      this.paused = true;
      this._ct = 0;
    }
  }
  for (const [p, f] of [
    ['src', '_src'],
    ['currentTime', '_ct']
  ]) {
    Object.defineProperty(HTMLMediaElement.prototype, p, {
      get() {
        return this[f];
      },
      set(v) {
        this[f] = v;
      },
      configurable: true
    });
  }
  for (const p of ['duration', 'playbackRate']) {
    Object.defineProperty(HTMLMediaElement.prototype, p, {
      get() {
        return this['_' + p] ?? 1;
      },
      set(v) {
        this['_' + p] = v;
      },
      configurable: true
    });
  }
  for (const p of ['buffered', 'seekable']) {
    Object.defineProperty(HTMLMediaElement.prototype, p, {
      get() {
        return { length: 0 };
      },
      configurable: true
    });
  }
  let n = 0;
  const document = new EventTarget();
  document.createElement = () => new HTMLMediaElement();
  const win = {
    ...world.win,
    MediaSource,
    SourceBuffer,
    HTMLMediaElement,
    document,
    URL: { createObjectURL: () => `blob:x/${++n}`, revokeObjectURL() {} }
  };
  if (!withAudio) {
    delete win.AudioDecoder;
  }
  return win;
}
