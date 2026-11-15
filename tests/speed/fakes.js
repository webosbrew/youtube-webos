export class Event {
  constructor(type) {
    this.type = type;
  }
}

export class EventTarget {
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

export function makeFakeWindow() {
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
      this.volume = 1;
      this.muted = false;
      this.paused = true;
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
  const document = new EventTarget();
  document.createElement = () => new HTMLMediaElement();
  return {
    Event,
    EventTarget,
    SourceBuffer,
    MediaSource,
    HTMLMediaElement,
    URL,
    document
  };
}
