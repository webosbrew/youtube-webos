import {
  classifyMp4,
  rewriteInitTimescale,
  parseInitInfo,
  audioConfigFromInit,
  demuxFragments,
  parseBoxes
} from './isobmff.js';
import {
  classifyWebm,
  rewriteTimecodeScale,
  findTimecodeScale,
  audioConfigFromWebmInit,
  demuxClusters,
  parseElements
} from './webm.js';
import { SpeedTimeMap } from './timemap.js';
import { attachElementShim } from './element-shim.js';

export function installMseHook(
  win,
  { getSpeed, createAudioSink, onRateRequest, onError, onNativeAudio }
) {
  const origAddSourceBuffer = win.MediaSource.prototype.addSourceBuffer;
  const origCreateObjectURL = win.URL.createObjectURL;
  const origSrcDesc = Object.getOwnPropertyDescriptor(
    win.HTMLMediaElement.prototype,
    'src'
  );

  const sessions = new WeakMap();
  const urlToMs = new Map();
  const msToEl = new WeakMap();
  const elToShim = new WeakMap();
  // The speed is decided once, at the first addSourceBuffer of a MediaSource,
  // and remembered even when it is 1: a later change of getSpeed() must not
  // turn half of the SourceBuffers of the same MediaSource into fakes.
  const decided = new WeakMap();

  // Attaching twice would stack two shims (x S^2): reuse a live one for the
  // same session, replace one that belongs to another session.
  function attach(el, session) {
    const cur = elToShim.get(el);
    if (cur && cur.session === session && cur.shim.isAttached()) return;
    if (cur && cur.shim.isAttached()) cur.shim.detach();
    const shim = attachElementShim(el, session.timeMap, { onRateRequest });
    elToShim.set(el, { shim, session });
  }

  win.URL.createObjectURL = function (obj) {
    const url = origCreateObjectURL.call(this, obj);
    if (obj instanceof win.MediaSource) {
      urlToMs.set(url, obj);
    }
    return url;
  };

  if (origSrcDesc) {
    Object.defineProperty(win.HTMLMediaElement.prototype, 'src', {
      get() {
        return origSrcDesc.get.call(this);
      },
      set(val) {
        const ms = urlToMs.get(val);
        if (ms) {
          msToEl.set(ms, this);
          const session = sessions.get(ms);
          if (session) attach(this, session);
        }
        origSrcDesc.set.call(this, val);
      }
    });
  }

  win.MediaSource.prototype.addSourceBuffer = function (mime) {
    if (!decided.has(this)) {
      decided.set(this, getSpeed());
      // A MediaSource at 1x plays the native audio: whatever engine the previous
      // one had must stop now, or both are heard.
      if (decided.get(this) === 1.0 && onNativeAudio) onNativeAudio();
    }
    const speed = decided.get(this);
    if (speed === 1.0) {
      return origAddSourceBuffer.call(this, mime);
    }

    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');

    let session = sessions.get(this);
    if (!session) {
      session = {
        speed,
        audio: null,
        video: null,
        timeMap: new SpeedTimeMap(speed)
      };
      sessions.set(this, session);
      patchMediaSource(this, session);

      const el = msToEl.get(this);
      if (el) attach(el, session);
    }

    if (isVideo) {
      const realSb = origAddSourceBuffer.call(this, mime);
      patchVideoSourceBuffer(realSb, mime, speed, onError);
      session.video = realSb;
      return realSb;
    } else if (isAudio) {
      const sink = createAudioSink({
        speed,
        element: msToEl.get(this) || null
      });
      const fakeSb = new FakeAudioSourceBuffer(win, mime, speed, sink, onError);
      session.audio = fakeSb;
      return fakeSb;
    } else {
      return origAddSourceBuffer.call(this, mime);
    }
  };

  function patchMediaSource(ms, session) {
    let origDurationDesc = Object.getOwnPropertyDescriptor(ms, 'duration');
    if (!origDurationDesc) {
      origDurationDesc = Object.getOwnPropertyDescriptor(
        win.MediaSource.prototype,
        'duration'
      );
    }
    if (origDurationDesc) {
      Object.defineProperty(ms, 'duration', {
        get() {
          const val = origDurationDesc.get.call(this);
          return isNaN(val) ? val : val * session.speed;
        },
        set(val) {
          origDurationDesc.set.call(this, val / session.speed);
        }
      });
    }

    let origSourceBuffersDesc = Object.getOwnPropertyDescriptor(
      ms,
      'sourceBuffers'
    );
    if (!origSourceBuffersDesc) {
      origSourceBuffersDesc = Object.getOwnPropertyDescriptor(
        win.MediaSource.prototype,
        'sourceBuffers'
      );
    }
    if (origSourceBuffersDesc) {
      Object.defineProperty(ms, 'sourceBuffers', {
        get() {
          const realSbList = origSourceBuffersDesc.get.call(this);
          const list = {
            length: realSbList.length + (session.audio ? 1 : 0),
            item(idx) {
              if (idx < realSbList.length) return realSbList.item(idx);
              if (idx === realSbList.length && session.audio)
                return session.audio;
              return undefined;
            }
          };
          for (let i = 0; i < realSbList.length; i++) {
            list[i] = realSbList[i];
          }
          if (session.audio) {
            list[realSbList.length] = session.audio;
          }
          return list;
        }
      });
    }
  }

  function looksLikeInitStart(u8) {
    if (
      u8.length >= 4 &&
      u8[0] === 0x1a &&
      u8[1] === 0x45 &&
      u8[2] === 0xdf &&
      u8[3] === 0xa3
    )
      return true;
    if (u8.length >= 8) {
      const t = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
      return t === 'ftyp' || t === 'moov';
    }
    return false;
  }

  function patchVideoSourceBuffer(sb, mime, speed, onError) {
    const origAppendBuffer = sb.appendBuffer;
    const origRemove = sb.remove;

    const isMp4 = mime.includes('mp4');
    const isWebm = mime.includes('webm');

    sb.appendBuffer = function (data) {
      const u8 = new Uint8Array(data);
      try {
        let isInit = false;
        if (isMp4) {
          const type = classifyMp4(u8);
          if (type === 'init' || type === 'init+media') isInit = true;
        } else if (isWebm) {
          const type = classifyWebm(u8);
          if (type === 'init' || type === 'init+media') isInit = true;
        }

        if (isInit) {
          let modified = new Uint8Array(u8);
          if (isMp4) {
            modified = rewriteInitTimescale(modified, speed).data;
          } else if (isWebm) {
            modified = rewriteTimecodeScale(modified, speed).data;
          }
          origAppendBuffer.call(this, modified.buffer || modified);
        } else {
          if (looksLikeInitStart(u8)) {
            // An init we cannot see whole cannot be rewritten: the video would
            // play at 1x while the audio is stretched. Say so; B2 falls back to 1x.
            throw new Error('init segment split across appends');
          }
          origAppendBuffer.call(this, data);
        }
      } catch (e) {
        if (onError) onError(e);
        origAppendBuffer.call(this, data);
      }
    };

    sb.remove = function (start, end) {
      origRemove.call(this, start / speed, end / speed);
    };

    const defineAccessor = (prop, scale) => {
      let desc = Object.getOwnPropertyDescriptor(sb, prop);
      let proto = sb;
      while (!desc && proto) {
        proto = Object.getPrototypeOf(proto);
        desc = Object.getOwnPropertyDescriptor(proto, prop);
      }
      if (!desc) return;
      Object.defineProperty(sb, prop, {
        get() {
          const val = desc.get.call(this);
          return val * scale;
        },
        set(val) {
          desc.set.call(this, val / scale);
        }
      });
    };

    defineAccessor('timestampOffset', speed);

    // appendWindowEnd = Infinity resta Infinity
    // Infinity / 1.5 = Infinity, Infinity * 1.5 = Infinity, so the generic accessor works.
    defineAccessor('appendWindowStart', speed);
    defineAccessor('appendWindowEnd', speed);

    let descBuf = Object.getOwnPropertyDescriptor(sb, 'buffered');
    let protoBuf = sb;
    while (!descBuf && protoBuf) {
      protoBuf = Object.getPrototypeOf(protoBuf);
      descBuf = Object.getOwnPropertyDescriptor(protoBuf, 'buffered');
    }
    if (descBuf) {
      Object.defineProperty(sb, 'buffered', {
        get() {
          const origBuf = descBuf.get.call(this);
          return {
            length: origBuf.length,
            start: (i) => origBuf.start(i) * speed,
            end: (i) => origBuf.end(i) * speed
          };
        }
      });
    }
  }

  function uninstall() {
    win.MediaSource.prototype.addSourceBuffer = origAddSourceBuffer;
    win.URL.createObjectURL = origCreateObjectURL;
    if (origSrcDesc) {
      Object.defineProperty(win.HTMLMediaElement.prototype, 'src', origSrcDesc);
    }
  }

  const MAX_REST = 4 * 1024 * 1024;

  class FakeAudioSourceBuffer extends win.EventTarget {
    constructor(win, mime, speed, sink, onError) {
      super();
      this.win = win;
      this.mime = mime;
      this.speed = speed;
      this.sink = sink;
      this.onError = onError;

      this.isMp4 = mime.includes('mp4');
      this.isWebm = mime.includes('webm');
      this.updating = false;
      this._timestampOffset = 0;
      this.rest = new Uint8Array(0);
      this.initInfo = null;
      this.bufferedRanges = [];

      this.onupdateend = null;
      this.onerror = null;
      this._gen = 0;
    }

    get timestampOffset() {
      return this._timestampOffset;
    }
    set timestampOffset(val) {
      this._timestampOffset = val;
    }

    get buffered() {
      if (this.bufferedRanges.length === 0) {
        return { length: 0, start: () => 0, end: () => 0 };
      }
      return {
        length: this.bufferedRanges.length,
        start: (i) => {
          if (i < 0 || i >= this.bufferedRanges.length)
            throw new RangeError('Index out of bounds');
          return this.bufferedRanges[i].start;
        },
        end: (i) => {
          if (i < 0 || i >= this.bufferedRanges.length)
            throw new RangeError('Index out of bounds');
          return this.bufferedRanges[i].end;
        }
      };
    }

    _addRange(start, end) {
      this.bufferedRanges.push({ start, end });
      this.bufferedRanges.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const r of this.bufferedRanges) {
        if (merged.length === 0) {
          merged.push(r);
        } else {
          const last = merged[merged.length - 1];
          if (r.start <= last.end + 0.001) {
            last.end = Math.max(last.end, r.end);
          } else {
            merged.push(r);
          }
        }
      }
      this.bufferedRanges = merged;
    }

    appendBuffer(data) {
      if (this.updating) {
        const err = new Error('InvalidStateError');
        err.name = 'InvalidStateError';
        throw err;
      }
      this.updating = true;
      this.dispatchEvent(new win.Event('updatestart'));

      const chunk = new Uint8Array(data);
      const u8 = new Uint8Array(this.rest.length + chunk.length);
      u8.set(this.rest, 0);
      u8.set(chunk, this.rest.length);

      try {
        if (this.isMp4) {
          const type = classifyMp4(u8);
          const moov = parseBoxes(u8, 0, u8.length).find(
            (b) => b.type === 'moov'
          );
          if (moov && moov.truncated) {
            this.rest = u8; // the init continues in the next append
          } else if (type === 'init' || type === 'init+media') {
            const cfg = audioConfigFromInit(u8);
            if (cfg.unsupported) {
              const err = new Error('Unsupported audio');
              err.name = 'NotSupportedError';
              throw err;
            }
            this.sink.configure(cfg);
            this.initInfo = parseInitInfo(u8);
            if (type === 'init+media') {
              const res = demuxFragments(u8, this.initInfo);
              this.rest = res.rest;
              if (res.samples.length > 0) {
                const adjusted = res.samples.map((s) => ({
                  ...s,
                  pts: s.pts + this._timestampOffset
                }));
                this.sink.push(adjusted);
                const start = adjusted[0].pts;
                const end =
                  adjusted[adjusted.length - 1].pts +
                  adjusted[adjusted.length - 1].duration;
                this._addRange(start, end);
              }
            } else {
              let nextBoxOffset = 0;
              const boxes = parseBoxes(u8, 0, u8.length);
              if (boxes.length > 0) {
                nextBoxOffset = boxes[boxes.length - 1].end;
              }
              if (boxes[boxes.length - 1].truncated) {
                this.rest = u8.subarray(boxes[boxes.length - 1].start);
              } else {
                this.rest = u8.subarray(nextBoxOffset);
              }
            }
          } else if (type === 'media' && this.initInfo) {
            const res = demuxFragments(u8, this.initInfo);
            this.rest = res.rest;
            if (res.samples.length > 0) {
              const adjusted = res.samples.map((s) => ({
                ...s,
                pts: s.pts + this._timestampOffset
              }));
              this.sink.push(adjusted);
              const start = adjusted[0].pts;
              const end =
                adjusted[adjusted.length - 1].pts +
                adjusted[adjusted.length - 1].duration;
              this._addRange(start, end);
            }
          } else {
            this.rest = u8;
          }
        } else if (this.isWebm) {
          const type = classifyWebm(u8);
          if (type === 'init' || type === 'init+media') {
            const cfg = audioConfigFromWebmInit(u8);
            if (cfg.unsupported) {
              const err = new Error('Unsupported audio');
              err.name = 'NotSupportedError';
              throw err;
            }
            this.sink.configure(cfg);
            const tcScaleObj = findTimecodeScale(u8);
            this.initInfo = {
              timecodeScale: tcScaleObj ? tcScaleObj.value : 1000000,
              trackNumber: cfg.trackNumber
            };
            if (type === 'init+media') {
              const res = demuxClusters(u8, this.initInfo);
              this.rest = res.rest;
              if (res.frames && res.frames.length > 0) {
                for (let i = 0; i < res.frames.length; i++) {
                  if (i < res.frames.length - 1) {
                    res.frames[i].duration =
                      res.frames[i + 1].pts - res.frames[i].pts;
                  } else {
                    res.frames[i].duration =
                      i > 0 && res.frames[i - 1].duration > 0
                        ? res.frames[i - 1].duration
                        : 0.02;
                  }
                }
                const adjusted = res.frames.map((f) => ({
                  ...f,
                  pts: f.pts + this._timestampOffset
                }));
                this.sink.push(adjusted);
                const start = adjusted[0].pts;
                const end =
                  adjusted[adjusted.length - 1].pts +
                  adjusted[adjusted.length - 1].duration;
                this._addRange(start, end);
              }
            } else {
              let nextOffset = 0;
              const elements = parseElements(u8, 0, u8.length);
              if (elements.length > 0) {
                nextOffset = elements[elements.length - 1].end;
                if (elements[elements.length - 1].truncated) {
                  this.rest = u8.subarray(elements[elements.length - 1].start);
                } else {
                  this.rest = u8.subarray(nextOffset);
                }
              } else {
                this.rest = new Uint8Array(0);
              }
            }
          } else if (type === 'media' && this.initInfo) {
            const res = demuxClusters(u8, this.initInfo);
            this.rest = res.rest;
            if (res.frames && res.frames.length > 0) {
              for (let i = 0; i < res.frames.length; i++) {
                if (i < res.frames.length - 1) {
                  res.frames[i].duration =
                    res.frames[i + 1].pts - res.frames[i].pts;
                } else {
                  res.frames[i].duration =
                    i > 0 && res.frames[i - 1].duration > 0
                      ? res.frames[i - 1].duration
                      : 0.02;
                }
              }
              const adjusted = res.frames.map((f) => ({
                ...f,
                pts: f.pts + this._timestampOffset
              }));
              this.sink.push(adjusted);
              const start = adjusted[0].pts;
              const end =
                adjusted[adjusted.length - 1].pts +
                adjusted[adjusted.length - 1].duration;
              this._addRange(start, end);
            }
          } else {
            this.rest = u8;
          }
        }
      } catch (e) {
        this.rest = new Uint8Array(0);
        if (this.onError) this.onError(e);
      }
      if (this.rest.length > MAX_REST) {
        // Never grow without bound on data we cannot parse.
        this.rest = new Uint8Array(0);
        if (this.onError) this.onError(new Error('unparsable audio data'));
      }

      this._finishLater();
    }

    _finishLater() {
      // Real SourceBuffers end an update asynchronously; an abort() in between
      // ends it right away, and this late callback must then do nothing.
      const gen = ++this._gen;
      Promise.resolve().then(() => {
        if (gen !== this._gen || !this.updating) return;
        this.dispatchEvent(new win.Event('update'));
        this.updating = false;
        const e = new win.Event('updateend');
        this.dispatchEvent(e);
        if (this.onupdateend) this.onupdateend(e);
      });
    }

    remove(start, end) {
      if (this.updating) {
        const err = new Error('InvalidStateError');
        err.name = 'InvalidStateError';
        throw err;
      }
      this.updating = true;
      this.dispatchEvent(new win.Event('updatestart'));

      this.sink.discard(start, end);

      const result = [];
      for (const r of this.bufferedRanges) {
        if (r.end <= start || r.start >= end) {
          result.push(r);
        } else {
          if (r.start < start) {
            result.push({ start: r.start, end: start });
          }
          if (r.end > end) {
            result.push({ start: end, end: r.end });
          }
        }
      }
      this.bufferedRanges = result;
      this._finishLater();
    }

    abort() {
      this.rest = new Uint8Array(0);
      if (this.updating) {
        this._gen++;
        this.updating = false;
        const eAbort = new win.Event('abort');
        this.dispatchEvent(eAbort);
        if (this.onabort) this.onabort(eAbort);
        const eUpdateEnd = new win.Event('updateend');
        this.dispatchEvent(eUpdateEnd);
        if (this.onupdateend) this.onupdateend(eUpdateEnd);
      }
    }

    changeType(type) {
      this.mime = type;
      this.isMp4 = type.includes('mp4');
      this.isWebm = type.includes('webm');
      this.rest = new Uint8Array(0);
      this.initInfo = null;
      this.sink.reset();
    }
  }
  return { uninstall };
}
