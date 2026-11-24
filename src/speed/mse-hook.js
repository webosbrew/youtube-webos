import {
  classifyMp4,
  rewriteInitTimescale,
  parseInitInfo,
  audioConfigFromInit,
  demuxFragments,
  parseBoxes,
  findMdhdTimescale
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

/**
 * Live sessions keep at most this much video (element seconds) appended ahead
 * of the playhead; YouTube's further appends wait (its data stays in its own
 * memory). A speed change then needs no removal of buffered media, which
 * froze the picture for 1-10 s on an LG C1: it applies from the next fragment
 * appended, a few seconds ahead.
 */
export const LIVE_AHEAD_CAP_S = 1.5;
const HOLD_POLL_MS = 100;

/** How far back a seek into media of an older speed is rebuilt, in content s. */
const SEEK_REBASE_S = 10;

const CLUSTER_ID = '1F 43 B6 75';
const SEGMENT_ID = '18 53 80 67';

function u8View(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

/** The init part of an init(+media) append: the bytes before the first fragment. */
function initPart(u8, isMp4) {
  if (isMp4) {
    const boxes = parseBoxes(u8, 0, u8.length);
    const moof = boxes.find((b) => b.type === 'moof');
    return moof ? u8.slice(0, moof.start) : u8.slice();
  }
  const top = parseElements(u8, 0, u8.length);
  const seg = top.find((e) => e.id === SEGMENT_ID);
  const kids = seg ? parseElements(u8, seg.dataStart, seg.end) : top;
  const cluster = kids.find((e) => e.id === CLUSTER_ID);
  return cluster ? u8.slice(0, cluster.start) : u8.slice();
}

/**
 * Media time (seconds, before timestampOffset) of the first fragment that starts
 * in this append, or null when the append continues an earlier fragment.
 */
function fragmentStartMediaTime(u8, isMp4, origScale) {
  if (isMp4) {
    const boxes = parseBoxes(u8, 0, u8.length);
    for (const b of boxes) {
      if (b.type === 'mdat' || b.truncated) return null;
      if (b.type !== 'moof') continue;
      const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const trafs = parseBoxes(u8, b.start + b.headerSize, b.end).filter(
        (x) => x.type === 'traf'
      );
      for (const traf of trafs) {
        const tfdt = parseBoxes(
          u8,
          traf.start + traf.headerSize,
          traf.end
        ).find((x) => x.type === 'tfdt');
        if (!tfdt || tfdt.truncated) continue;
        const p = tfdt.start + tfdt.headerSize;
        const t =
          view.getUint8(p) === 1
            ? view.getUint32(p + 4) * 0x100000000 + view.getUint32(p + 8)
            : view.getUint32(p + 4);
        return t / origScale;
      }
      return null;
    }
    return null;
  }
  let els = parseElements(u8, 0, u8.length);
  const seg = els.find((e) => e.id === SEGMENT_ID);
  if (seg) els = parseElements(u8, seg.dataStart, seg.end);
  const first = els[0];
  const cluster = seg ? els.find((e) => e.id === CLUSTER_ID) : first;
  if (!cluster || cluster.id !== CLUSTER_ID) return null;
  const tc = parseElements(u8, cluster.dataStart, cluster.end).find(
    (e) => e.id === 'E7'
  );
  if (!tc || tc.truncated) return null;
  let v = 0;
  for (let i = 0; i < tc.size; i++) v = v * 256 + u8[tc.dataStart + i];
  return (v * origScale) / 1e9;
}

function readVintAt(u8, p, keepMarker) {
  if (p >= u8.length) return null;
  const first = u8[p];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || p + len > u8.length) return null;
  let v = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    v = v * 256 + u8[p + i];
    if (u8[p + i] !== 0xff) allOnes = false;
  }
  return { len, value: allOnes && !keepMarker ? -1 : v };
}

/**
 * Bytes of the fragment that starts in this append still to come after it:
 * > 0 while YouTube is in the middle of a fragment (it appends one in several
 * chunks), Infinity when the size is not known yet.
 */
function fragmentBytesRemaining(u8, isMp4) {
  let remaining = Infinity;
  if (isMp4) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let i = 0;
    while (i + 8 <= u8.length) {
      let size = view.getUint32(i);
      const type = String.fromCharCode(
        u8[i + 4],
        u8[i + 5],
        u8[i + 6],
        u8[i + 7]
      );
      if (size === 1) {
        if (i + 16 > u8.length) break;
        size = view.getUint32(i + 8) * 0x100000000 + view.getUint32(i + 12);
      } else if (size === 0) {
        return type === 'mdat' ? Infinity : remaining;
      }
      if (size < 8) break;
      if (type === 'moof') remaining = Infinity;
      if (type === 'mdat') remaining = i + size - u8.length;
      i += size;
    }
    return remaining;
  }
  let p = 0;
  let end = u8.length;
  const seg = parseElements(u8, 0, u8.length).find((e) => e.id === SEGMENT_ID);
  if (seg) {
    p = seg.dataStart;
    end = Math.max(seg.end, u8.length);
  }
  while (p < end) {
    const id = readVintAt(u8, p, true);
    if (!id) break;
    const size = readVintAt(u8, p + id.len, false);
    if (!size) break;
    const dataStart = p + id.len + size.len;
    const isCluster =
      id.len === 4 &&
      u8[p] === 0x1f &&
      u8[p + 1] === 0x43 &&
      u8[p + 2] === 0xb6 &&
      u8[p + 3] === 0x75;
    if (size.value === -1) return isCluster ? 0 : remaining;
    if (isCluster) remaining = dataStart + size.value - u8.length;
    p = dataStart + size.value;
  }
  return remaining;
}

export function installMseHook(
  win,
  {
    getSpeed,
    createAudioSink,
    onRateRequest,
    onError,
    onNativeAudio,
    // Live sessions play every speed, 1x included, through the speed pipeline,
    // so the speed can change without reloading the video.
    useLive = () => false
  }
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
  let lastLiveSession = null;

  // Attaching twice would stack two shims (x S^2): reuse a live one for the
  // same session, replace one that belongs to another session.
  function attach(el, session) {
    session.el = el;
    const cur = elToShim.get(el);
    if (cur && cur.session === session && cur.shim.isAttached()) return;
    if (cur && cur.shim.isAttached()) cur.shim.detach();
    const shim = attachElementShim(el, session.timeMap, {
      onRateRequest,
      live: session.live,
      beforeSeek: session.live ? (c) => session.beforeSeek(c) : null,
      targetSpeed: session.live ? () => session.targetSpeed() : null
    });
    elToShim.set(el, { shim, session });
  }

  const origRevokeObjectURL = win.URL.revokeObjectURL;
  win.URL.createObjectURL = function (obj) {
    const url = origCreateObjectURL.call(this, obj);
    if (obj instanceof win.MediaSource) {
      urlToMs.set(url, obj);
      // Never grows without bound, even if YouTube does not revoke its URLs
      // (each entry keeps a MediaSource, its session and audio engine alive).
      if (urlToMs.size > 8) urlToMs.delete(urlToMs.keys().next().value);
    }
    return url;
  };
  if (origRevokeObjectURL) {
    win.URL.revokeObjectURL = function (url) {
      urlToMs.delete(url);
      return origRevokeObjectURL.call(this, url);
    };
  }

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

  function createSession(ms, speed, live) {
    const session = {
      speed,
      live,
      ms,
      el: null,
      audio: null,
      video: null,
      videoCtl: null,
      timeMap: new SpeedTimeMap(speed),
      contentDuration: NaN,
      pending: null,
      targetSpeed() {
        return session.pending ? session.pending.speed : session.timeMap.speed;
      },
      /** Content time the video element is at (through the shim). */
      now() {
        return session.el ? session.el.currentTime : 0;
      },
      /**
       * Live speed change: the next fragment YouTube appends (at most
       * LIVE_AHEAD_CAP_S plus one fragment ahead) and all after it play at
       * `speed`. Nothing buffered is removed.
       */
      requestSpeed(speed) {
        if (!session.videoCtl) return false;
        if (session.timeMap.speed === speed) {
          session.pending = null;
          return true;
        }
        session.pending = { speed, from: session.now() };
        // The audio queued ahead (up to the audio engine's lead) may already
        // run past the end of the buffered video, where the change can start.
        const sink = session.audio && session.audio.sink;
        if (sink && sink.truncateAt) sink.truncateAt(session.genLimit());
        return true;
      },
      /** See AudioEngine genLimit. */
      genLimit() {
        if (!session.pending || !session.videoCtl) return Infinity;
        return session.videoCtl.bufferedEndContent();
      },
      /**
       * A seek into media of another speed than the current one: rebuild from a
       * little before the target so it plays at the speed the user chose.
       */
      beforeSeek(c) {
        const target = session.targetSpeed();
        if (!session.videoCtl || session.timeMap.speedAtContent(c) === target)
          return;
        session.pending = null;
        const c0 = Math.max(0, c - SEEK_REBASE_S);
        session.timeMap.addSegment(c0, target);
        session.videoCtl.rebuildFrom(c0);
        session.videoCtl.syncDuration();
      },
      /** Called by the video controller for each fragment that starts. */
      onFragmentStart(c) {
        const p = session.pending;
        if (p && c >= p.from) {
          session.pending = null;
          if (session.timeMap.speedAtContent(c) !== p.speed) {
            session.timeMap.addSegment(c, p.speed);
            session.videoCtl.syncDuration();
          }
        }
      },
      updateDuration() {
        const d = session.contentDuration;
        if (!isFinite(d) || session.ms.readyState !== 'open') return;
        try {
          session.realDuration = session.timeMap.toElement(d);
        } catch {
          // Only the reported duration is affected.
        }
      }
    };
    return session;
  }

  win.MediaSource.prototype.addSourceBuffer = function (mime) {
    if (!decided.has(this)) {
      const speed = getSpeed();
      const live = !!useLive();
      decided.set(this, { speed, live });
      // A MediaSource at 1x plays the native audio: whatever engine the previous
      // one had must stop now, or both are heard.
      if (speed === 1.0 && !live && onNativeAudio) onNativeAudio();
    }
    const { speed, live } = decided.get(this);
    if (speed === 1.0 && !live) {
      return origAddSourceBuffer.call(this, mime);
    }

    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');

    let session = sessions.get(this);
    if (!session) {
      session = createSession(this, speed, live);
      sessions.set(this, session);
      if (live) lastLiveSession = session;
      patchMediaSource(this, session);

      const el = msToEl.get(this);
      if (el) attach(el, session);
    }

    if (isVideo) {
      const realSb = origAddSourceBuffer.call(this, mime);
      session.videoCtl = patchVideoSourceBuffer(realSb, mime, session, onError);
      session.video = realSb;
      return realSb;
    } else if (isAudio) {
      const sink = createAudioSink({
        speed,
        element: msToEl.get(this) || null,
        speedAt: live ? (c) => session.timeMap.speedAtContent(c) : null,
        contentAhead: live
          ? (c, dt) =>
              session.timeMap.toContent(session.timeMap.toElement(c) + dt)
          : null,
        genLimit: live ? () => session.genLimit() : null
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
          return isNaN(val) ? val : session.timeMap.toContent(val);
        },
        set(val) {
          session.contentDuration = val;
          origDurationDesc.set.call(this, session.timeMap.toElement(val));
        }
      });
      Object.defineProperty(session, 'realDuration', {
        get: () => origDurationDesc.get.call(ms),
        set: (v) => {
          origDurationDesc.set.call(ms, v);
        }
      });
      // YouTube may set the duration before its first addSourceBuffer, i.e.
      // before this patch: that value is content time. Keep it, and put the
      // element on the map's timeline (seen on an LG C1: never set again, so
      // after a few speed changes the reported duration was 25 s off).
      try {
        const d = origDurationDesc.get.call(ms);
        if (isFinite(d) && d > 0) {
          session.contentDuration = d;
          if (session.timeMap.toElement(d) !== d)
            origDurationDesc.set.call(ms, session.timeMap.toElement(d));
        }
      } catch {
        // Not open yet: YouTube sets it later, through the patched setter.
      }
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

  /**
   * Accessor for a property as the object had it before the patch: a getter on
   * the prototype (browsers) or a plain data property (test fakes), whose value
   * then lives in a box once our own accessor replaces it.
   */
  function findDesc(obj, prop) {
    let proto = obj;
    let desc;
    while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, prop))) {
      proto = Object.getPrototypeOf(proto);
    }
    if (!desc) return null;
    if (desc.get || desc.set) {
      return {
        get: () => (desc.get ? desc.get.call(obj) : undefined),
        set: desc.set ? (v) => desc.set.call(obj, v) : null
      };
    }
    const box = { v: desc.value };
    return { get: () => box.v, set: (v) => (box.v = v) };
  }

  /**
   * Patches the real video SourceBuffer so that the media lands on the element
   * timeline of session.timeMap:
   * - each init segment is rewritten for the speed of the fragments that follow
   *   it (timescale x S for MP4, TimecodeScale / S for WebM);
   * - at every fragment start the real timestampOffset places the fragment in
   *   its segment of the map: element = e0 + (content - c0) / s;
   * - when a fragment needs another speed than the active init, the init is
   *   appended again, rewritten, before it (an internal append).
   * Internal operations run through a queue; their events are hidden from
   * YouTube and `updating` stays true until the queue is empty.
   */
  function patchVideoSourceBuffer(sb, mime, session, onError) {
    const map = session.timeMap;
    const origAppendBuffer = sb.appendBuffer;
    const origRemove = sb.remove;
    const origAbort = sb.abort;
    const isMp4 = mime.includes('mp4');

    const realTO = findDesc(sb, 'timestampOffset');
    const realAWS = findDesc(sb, 'appendWindowStart');
    const realAWE = findDesc(sb, 'appendWindowEnd');
    const realBuffered = findDesc(sb, 'buffered');
    const realUpdating = findDesc(sb, 'updating');
    const isUpdating = () => (realUpdating ? !!realUpdating.get() : false);

    const st = {
      ytTO: 0,
      aws: 0,
      awe: Infinity,
      init: null,
      origScale: null,
      activeScale: null,
      fragStarts: [],
      queue: [],
      internal: false,
      busy: false,
      // Bytes of the current fragment YouTube has still to append, and a cut
      // waiting for the fragment to end: removing media while a fragment is
      // half appended leaves its tail on the old scale, a hole in the timeline
      // (seen on an LG C1: a 1.9 s freeze after the switch point).
      fragRemaining: 0,
      pendingCut: null,
      held: [],
      holdTimer: null,
      // Diagnostics, read from DevTools through window.ytafSpeedHook.
      log: []
    };
    session.videoState = st;
    function note(...a) {
      st.log.push([Date.now() % 100000, ...a]);
      if (st.log.length > 300) st.log.splice(0, st.log.length - 300);
    }
    // The element's own clock, under the shim: the prototype's getter.
    const realElCT = Object.getOwnPropertyDescriptor(
      win.HTMLMediaElement.prototype,
      'currentTime'
    );

    /**
     * Seconds of video buffered ahead of the playhead (element time), in the
     * range that holds it; 0 when the playhead is not buffered.
     */
    function aheadS() {
      const b = realBuffered && realBuffered.get();
      if (!b || !b.length || !session.el || !realElCT || !realElCT.get)
        return 0;
      const t = realElCT.get.call(session.el);
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= t + 0.1 && t <= b.end(i)) return b.end(i) - t;
      }
      return 0;
    }

    /** Releases YouTube's held appends once the playhead needs them. */
    function pumpHeld() {
      st.holdTimer = null;
      if (!st.held.length) return;
      if (aheadS() > LIVE_AHEAD_CAP_S) {
        st.holdTimer = win.setTimeout(pumpHeld, HOLD_POLL_MS);
        return;
      }
      const data = st.held.shift();
      processAppend(data, true);
      if (st.held.length) st.holdTimer = win.setTimeout(pumpHeld, 0);
    }

    // Registered before YouTube's listeners: hides the events of our own ops.
    for (const type of [
      'updatestart',
      'update',
      'updateend',
      'error',
      'abort'
    ]) {
      sb.addEventListener(type, (e) => {
        if (!st.internal) return;
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (type === 'updateend') {
          st.internal = false;
          Promise.resolve().then(runQueue);
        }
      });
    }

    function rewriteInit(u8, scale) {
      if (scale === 1) return u8;
      return isMp4
        ? rewriteInitTimescale(u8, scale).data
        : rewriteTimecodeScale(u8, scale).data;
    }

    function setReal(desc, value) {
      if (!desc || !desc.set) return;
      try {
        if (desc.get() !== value) desc.set(value);
      } catch {
        // A value the browser refuses keeps the previous one.
      }
    }

    /** Positions the next fragment (content start c) on the element timeline. */
    function placeFragment(c) {
      const seg = map.segmentAtContent(c);
      note(
        'place',
        +c.toFixed(3),
        seg.s,
        +(st.ytTO / seg.s + seg.e0 - seg.c0 / seg.s).toFixed(3)
      );
      setReal(realTO, st.ytTO / seg.s + seg.e0 - seg.c0 / seg.s);
      const aws = map.toElement(st.aws);
      const awe = map.toElement(st.awe);
      setReal(realAWE, Infinity);
      setReal(realAWS, aws);
      setReal(realAWE, awe);
    }

    function recordFragment(c) {
      const f = st.fragStarts;
      const i = f.findIndex((x) => x >= c - 0.001);
      if (i !== -1 && Math.abs(f[i] - c) < 0.001) return;
      if (i === -1) f.push(c);
      else f.splice(i, 0, c);
      if (f.length > 400) f.splice(0, f.length - 400);
    }

    function enqueue(op) {
      st.queue.push(op);
      if (!st.busy) runQueue();
    }

    function runQueue() {
      if (st.internal) return;
      if (isUpdating()) {
        // A real op of YouTube's is running: continue on its updateend.
        sb.addEventListener(
          'updateend',
          () => Promise.resolve().then(runQueue),
          {
            once: true
          }
        );
        return;
      }
      const op = st.queue.shift();
      if (!op) {
        st.busy = false;
        return;
      }
      st.busy = true;
      st.internal = op.internal;
      try {
        const started = op.run();
        if (started === false) {
          st.internal = false;
          Promise.resolve().then(runQueue);
        } else if (!op.internal) {
          // YouTube's own op: its updateend reaches YouTube; go on after it.
          sb.addEventListener(
            'updateend',
            () => Promise.resolve().then(runQueue),
            { once: true }
          );
        }
      } catch (e) {
        st.internal = false;
        if (onError && op.internal) onError(e);
        if (!op.internal) {
          // YouTube was told this op is under way: end it the way MSE would.
          sb.dispatchEvent(new win.Event('error'));
          sb.dispatchEvent(new win.Event('updateend'));
        }
        Promise.resolve().then(runQueue);
      }
    }

    sb.appendBuffer = function (data) {
      // Live: hold media appends while enough video is buffered ahead.
      if (session.live && (st.held.length || aheadS() > LIVE_AHEAD_CAP_S)) {
        let isInitData;
        try {
          const u = u8View(data);
          const t = isMp4 ? classifyMp4(u) : classifyWebm(u);
          isInitData = t === 'init' || t === 'init+media';
        } catch {
          isInitData = false;
        }
        if (!isInitData || st.held.length) {
          st.held.push(data);
          if (st.holdTimer === null)
            st.holdTimer = win.setTimeout(pumpHeld, HOLD_POLL_MS);
          return undefined;
        }
      }
      return processAppend(data, false);
    };

    function processAppend(data, released) {
      const u8 = u8View(data);
      let type;
      try {
        type = isMp4 ? classifyMp4(u8) : classifyWebm(u8);
      } catch {
        type = 'media';
      }
      const isInit = type === 'init' || type === 'init+media';

      if (!isInit && looksLikeInitStart(u8)) {
        // An init we cannot see whole cannot be rewritten: the video would
        // play at 1x while the audio is stretched. Say so; B2 falls back to 1x.
        if (onError) onError(new Error('init segment split across appends'));
        return origAppendBuffer.call(sb, data);
      }

      let bytes = data;
      let fragC = null;
      let needInit = null;
      try {
        if (isInit) {
          st.init = initPart(u8, isMp4);
          st.origScale = isMp4
            ? findMdhdTimescale(st.init)?.timescale || 1
            : findTimecodeScale(st.init)?.value || 1000000;
        }
        if (st.init) {
          const mt = fragmentStartMediaTime(u8, isMp4, st.origScale);
          if (mt !== null) {
            fragC = mt + st.ytTO;
            session.onFragmentStart(fragC);
            recordFragment(fragC);
          }
        }
        const scale =
          fragC !== null
            ? map.speedAtContent(fragC)
            : isInit
              ? map.speed
              : null;
        if (isInit) {
          bytes = rewriteInit(new Uint8Array(u8), scale);
          st.activeScale = scale;
        } else if (scale !== null && scale !== st.activeScale) {
          needInit = scale;
        }
      } catch (e) {
        if (onError) onError(e);
        bytes = data;
        fragC = null;
        needInit = null;
      }

      const run = () => {
        if (fragC !== null) placeFragment(fragC);
        origAppendBuffer.call(sb, bytes);
      };

      // A cut that waited for a fragment boundary: before a new fragment, or
      // after the append that completes the current one.
      let cutBefore = null;
      let cutAfter = null;
      if (fragC !== null) {
        if (st.pendingCut !== null) {
          cutBefore = st.pendingCut;
          st.pendingCut = null;
        }
        try {
          st.fragRemaining = fragmentBytesRemaining(u8, isMp4);
        } catch {
          st.fragRemaining = Infinity;
        }
      } else if (!isInit) {
        st.fragRemaining -= u8.length;
      }
      if (st.pendingCut !== null && st.fragRemaining <= 0) {
        cutAfter = st.pendingCut;
        st.pendingCut = null;
      }

      if (
        needInit === null &&
        cutBefore === null &&
        !released &&
        !st.busy &&
        st.queue.length === 0
      ) {
        // Fast path: synchronous, so MSE exceptions reach YouTube as usual.
        if (fragC !== null) placeFragment(fragC);
        const r = origAppendBuffer.call(sb, bytes);
        if (cutAfter !== null) enqueueCut(cutAfter);
        return r;
      }
      if (cutBefore !== null) enqueueCut(cutBefore);
      if (needInit !== null) {
        const scale = needInit;
        enqueue({
          internal: true,
          run: () => {
            if (fragC !== null) placeFragment(fragC);
            note('init', scale);
            st.activeScale = scale;
            origAppendBuffer.call(sb, rewriteInit(st.init, scale));
          }
        });
      }
      enqueue({ internal: false, run });
      if (cutAfter !== null) enqueueCut(cutAfter);
      return undefined;
    }

    sb.remove = function (start, end) {
      const a = map.toElement(start);
      const b = map.toElement(end);
      if (!st.busy && st.queue.length === 0) return origRemove.call(this, a, b);
      enqueue({ internal: false, run: () => origRemove.call(sb, a, b) });
      return undefined;
    };

    sb.abort = function () {
      const hadQueuedOwn =
        st.held.length > 0 || st.queue.some((op) => !op.internal);
      st.held = [];
      if (st.holdTimer !== null) win.clearTimeout(st.holdTimer);
      st.holdTimer = null;
      st.queue = st.queue.filter((op) => op.internal);
      const r = origAbort ? origAbort.call(this) : undefined;
      // abort() resets the parser: no fragment is half appended any more.
      st.fragRemaining = 0;
      if (st.pendingCut !== null) {
        const c = st.pendingCut;
        st.pendingCut = null;
        enqueueCut(c);
      }
      if (hadQueuedOwn && !isUpdating()) {
        sb.dispatchEvent(new win.Event('abort'));
        sb.dispatchEvent(new win.Event('updateend'));
      }
      return r;
    };

    Object.defineProperty(sb, 'updating', {
      configurable: true,
      get() {
        return (
          isUpdating() || st.busy || st.queue.length > 0 || st.held.length > 0
        );
      },
      set(v) {
        if (realUpdating && realUpdating.set) realUpdating.set(v);
      }
    });

    Object.defineProperty(sb, 'timestampOffset', {
      configurable: true,
      get: () => st.ytTO,
      set: (v) => {
        st.ytTO = v;
      }
    });
    Object.defineProperty(sb, 'appendWindowStart', {
      configurable: true,
      get: () => st.aws,
      set: (v) => {
        st.aws = v;
      }
    });
    Object.defineProperty(sb, 'appendWindowEnd', {
      configurable: true,
      get: () => st.awe,
      set: (v) => {
        st.awe = v;
      }
    });

    if (realBuffered) {
      Object.defineProperty(sb, 'buffered', {
        configurable: true,
        get() {
          return map.mapRanges(realBuffered.get(), 'toContent');
        }
      });
    }

    return {
      aheadS,
      /** Re-maps the MediaSource duration once the SourceBuffer is idle. */
      syncDuration() {
        enqueue({
          internal: true,
          run: () => {
            session.updateDuration();
            return false;
          }
        });
      },
      /** Content time where the buffered range holding the playhead ends. */
      bufferedEndContent() {
        const b = realBuffered && realBuffered.get();
        if (!b || !b.length || !session.el || !realElCT || !realElCT.get)
          return Infinity;
        const t = realElCT.get.call(session.el);
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= t + 0.1 && t <= b.end(i))
            return map.toContent(b.end(i));
        }
        return Infinity;
      },
      /** Removes what is buffered from content time c on (internal op). */
      rebuildFrom(c) {
        st.fragStarts = st.fragStarts.filter((f) => f < c - 0.001);
        if (st.fragRemaining > 0) {
          st.pendingCut =
            st.pendingCut === null ? c : Math.min(st.pendingCut, c);
          return;
        }
        enqueueCut(c);
      }
    };

    function enqueueCut(c) {
      enqueue({
        internal: true,
        run: () => {
          const b = realBuffered && realBuffered.get();
          const e = map.toElement(c);
          if (!b || !b.length || b.end(b.length - 1) <= e) {
            session.updateDuration();
            return false;
          }
          note('cut', +c.toFixed(3), +e.toFixed(3));
          origRemove.call(sb, e, Infinity);
          return true;
        }
      });
      enqueue({
        internal: true,
        run: () => {
          session.updateDuration();
          return false;
        }
      });
    }
  }

  function debug() {
    return lastLiveSession;
  }

  /**
   * Where the last live speed change stands, for the on-screen countdown:
   * 'pending' (the fragment that starts it is not appended yet: it begins at
   * the end of the buffer), 'scheduled' (appended, starts at a known element
   * time) or 'done'. etaS is in wall-clock seconds (the element plays at 1x).
   */
  function switchStatus() {
    const s = lastLiveSession;
    if (!s || !s.el || !s.videoCtl) return null;
    const ct = Object.getOwnPropertyDescriptor(
      win.HTMLMediaElement.prototype,
      'currentTime'
    );
    const t = ct && ct.get ? ct.get.call(s.el) : 0;
    if (s.pending) {
      return {
        state: 'pending',
        target: s.pending.speed,
        etaS: Math.max(0, s.videoCtl.aheadS())
      };
    }
    const segs = s.timeMap.segments;
    const seg = segs[segs.length - 1];
    if (seg.e0 > t + 0.02) {
      return { state: 'scheduled', target: seg.s, etaS: seg.e0 - t };
    }
    return { state: 'done', target: seg.s, etaS: 0 };
  }

  function switchSpeed(speed) {
    const s = lastLiveSession;
    if (!s || !s.el || s.ms.readyState !== 'open' || !s.videoCtl) return false;
    return s.requestSpeed(speed);
  }

  function uninstall() {
    win.MediaSource.prototype.addSourceBuffer = origAddSourceBuffer;
    win.URL.createObjectURL = origCreateObjectURL;
    if (origRevokeObjectURL) win.URL.revokeObjectURL = origRevokeObjectURL;
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
        if (this.isMp4 || this.isWebm) this._appendAudio(u8);
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

    _appendAudio(data) {
      const mp4 = this.isMp4;
      const type = mp4 ? classifyMp4(data) : classifyWebm(data);
      if (
        mp4 &&
        parseBoxes(data, 0, data.length).find((box) => box.type === 'moov')
          ?.truncated
      ) {
        this.rest = data;
        return;
      }

      if (type === 'init' || type === 'init+media') {
        const config = mp4
          ? audioConfigFromInit(data)
          : audioConfigFromWebmInit(data);
        if (config.unsupported) {
          const error = new Error('Unsupported audio');
          error.name = 'NotSupportedError';
          throw error;
        }
        this.sink.configure(config);
        this.initInfo = mp4
          ? parseInitInfo(data)
          : {
              timecodeScale: findTimecodeScale(data)?.value ?? 1000000,
              trackNumber: config.trackNumber
            };
      }

      if (type === 'init') {
        const elements = mp4
          ? parseBoxes(data, 0, data.length)
          : parseElements(data, 0, data.length);
        const last = elements[elements.length - 1];
        this.rest = last
          ? data.subarray(last.truncated ? last.start : last.end)
          : new Uint8Array(0);
      } else if (type === 'init+media' || (type === 'media' && this.initInfo)) {
        const result = mp4
          ? demuxFragments(data, this.initInfo)
          : demuxClusters(data, this.initInfo);
        this.rest = result.rest;
        const samples = mp4 ? result.samples : result.frames;
        if (!samples?.length) return;

        if (!mp4) {
          // The last WebM frame has no next timestamp. Reuse its neighbor's
          // duration when available, otherwise use an Opus frame of 20 ms.
          for (let i = 1; i < samples.length; i++) {
            samples[i - 1].duration = samples[i].pts - samples[i - 1].pts;
          }
          const previous = samples[samples.length - 2]?.duration;
          samples[samples.length - 1].duration = previous > 0 ? previous : 0.02;
        }
        const adjusted = samples.map((sample) => ({
          ...sample,
          pts: sample.pts + this._timestampOffset
        }));
        this.sink.push(adjusted);
        const last = adjusted[adjusted.length - 1];
        this._addRange(adjusted[0].pts, last.pts + last.duration);
      } else {
        this.rest = data;
      }
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
  return { uninstall, switchSpeed, switchStatus, debug };
}
