export function makeFakeWindow() {
  class Event {
    constructor(type, eventInitDict) {
      this.type = type;
      if (eventInitDict) {
        Object.assign(this, eventInitDict);
      }
    }
  }

  class Error {
    constructor(message) {
      this.message = message;
      this.name = 'Error';
    }
  }

  class RangeError extends Error {
    constructor(message) {
      super(message);
      this.name = 'RangeError';
    }
  }

  class EventTarget {
    constructor() {
      this.listeners = new Map();
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) {
      if (this.listeners.has(type)) {
        this.listeners.get(type).delete(listener);
      }
    }
    dispatchEvent(event) {
      if (this.listeners.has(event.type)) {
        for (const listener of this.listeners.get(event.type)) {
          if (typeof listener === 'function') {
            listener(event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
        }
      }
      const handlerName = `on${event.type}`;
      if (typeof this[handlerName] === 'function') {
        this[handlerName](event);
      }
      return true;
    }
  }

  class FakeSourceBuffer extends EventTarget {
    constructor() {
      super();
      this.appendedBytes = [];
      this.removeCalls = [];
      this._timestampOffset = 0;
      this._appendWindowStart = 0;
      this._appendWindowEnd = Infinity;
      this._buffered = { length: 0, start: () => 0, end: () => 0 };
      this.updating = false;
    }

    appendBuffer(data) {
      if (this.updating) {
        const e = new Error('InvalidStateError');
        e.name = 'InvalidStateError';
        throw e; // Mimic DOM
      }
      this.appendedBytes.push(new Uint8Array(data));
      this.updating = true;
      this.dispatchEvent(new Event('updatestart'));

      // Async updateend
      setTimeout(() => {
        this.dispatchEvent(new Event('update'));
        this.updating = false;
        this.dispatchEvent(new Event('updateend'));
      }, 0);
    }

    remove(start, end) {
      if (this.updating) {
        const e = new Error('InvalidStateError');
        e.name = 'InvalidStateError';
        throw e;
      }
      this.removeCalls.push({ start, end });
      this.updating = true;
      this.dispatchEvent(new Event('updatestart'));
      setTimeout(() => {
        this.dispatchEvent(new Event('update'));
        this.updating = false;
        this.dispatchEvent(new Event('updateend'));
      }, 0);
    }

    abort() {}
    changeType(_type) {}

    get timestampOffset() {
      return this._timestampOffset;
    }
    set timestampOffset(val) {
      this._timestampOffset = val;
    }

    get appendWindowStart() {
      return this._appendWindowStart;
    }
    set appendWindowStart(val) {
      this._appendWindowStart = val;
    }

    get appendWindowEnd() {
      return this._appendWindowEnd;
    }
    set appendWindowEnd(val) {
      this._appendWindowEnd = val;
    }

    get buffered() {
      return this._buffered;
    }
  }

  class SourceBufferList {
    constructor() {
      this.buffers = [];
    }
    get length() {
      return this.buffers.length;
    }
    item(index) {
      return this.buffers[index];
    }
    add(buffer) {
      this.buffers.push(buffer);
      this[this.buffers.length - 1] = buffer;
    }
    remove(buffer) {
      const index = this.buffers.indexOf(buffer);
      if (index > -1) {
        this.buffers.splice(index, 1);
        for (let i = 0; i < this.buffers.length; i++) {
          this[i] = this.buffers[i];
        }
        delete this[this.buffers.length];
      }
    }
  }

  class MediaSource extends EventTarget {
    constructor() {
      super();
      this._sourceBuffers = new SourceBufferList();
      this._duration = NaN;
      this.readyState = 'closed';
    }

    addSourceBuffer(_type) {
      const sb = new FakeSourceBuffer();
      this._sourceBuffers.add(sb);
      return sb;
    }

    removeSourceBuffer(sb) {
      this._sourceBuffers.remove(sb);
    }

    get sourceBuffers() {
      return this._sourceBuffers;
    }

    get duration() {
      return this._duration;
    }
    set duration(val) {
      this._duration = val;
    }

    static isTypeSupported(_type) {
      return true;
    }
  }

  class HTMLMediaElement extends EventTarget {
    constructor() {
      super();
      this._src = '';
      this._currentTime = 0;
      this._duration = NaN;
      this._buffered = { length: 0, start: () => 0, end: () => 0 };
      this._seekable = { length: 0, start: () => 0, end: () => 0 };
      this._playbackRate = 1;
      this._defaultPlaybackRate = 1;
    }

    get src() {
      return this._src;
    }
    set src(val) {
      this._src = val;
    }

    get currentTime() {
      return this._currentTime;
    }
    set currentTime(val) {
      this._currentTime = val;
    }

    get duration() {
      return this._duration;
    }
    set duration(val) {
      this._duration = val;
    }

    get buffered() {
      return this._buffered;
    }
    get seekable() {
      return this._seekable;
    }

    get playbackRate() {
      return this._playbackRate;
    }
    set playbackRate(val) {
      this._playbackRate = val;
    }

    get defaultPlaybackRate() {
      return this._defaultPlaybackRate;
    }
    set defaultPlaybackRate(val) {
      this._defaultPlaybackRate = val;
    }
  }

  class HTMLVideoElement extends HTMLMediaElement {}

  const document = {
    createElement(tag) {
      if (tag === 'video') {
        return new HTMLVideoElement();
      }
      return {};
    }
  };

  let blobCounter = 0;
  const URL = {
    createObjectURL(_obj) {
      return `blob:fake/${++blobCounter}`;
    },
    revokeObjectURL(_url) {}
  };

  return {
    EventTarget,
    Event,
    Error,
    RangeError,
    MediaSource,
    FakeSourceBuffer,
    HTMLMediaElement,
    HTMLVideoElement,
    document,
    URL
  };
}
