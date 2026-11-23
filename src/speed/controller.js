import { AudioEngine } from './audio-engine.js';
import { isSupportedSpeed } from './timemap.js';
import { hasAudioCodecs } from './legacy-decoder.js';

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

/**
 * How long to wait after the last speed change before reloading the video.
 * Measured on the TV (LG OLED C4, webOS 24): pressing YELLOW several times to reach 2x
 * reloaded the video at every press, and a reload started while the previous
 * one was loading read getCurrentTime() = 0, so the position was lost. One
 * reload per burst of presses, at the position of the first press, fixes both.
 */
export const RELOAD_DELAY_MS = 500;

/**
 * Audio scheduled ahead on the AudioContext. Measured on an LG C1: opening the
 * player controls blocks the page for up to ~1 s, which emptied the former
 * 0.4 s queue (a 250 ms hole and a resync). Pause, seek and volume act on the
 * queue at once, and speed changes are planned through the time map, so a
 * longer queue costs nothing there.
 */
export const AUDIO_LEAD_S = 1.6;

/** localStorage key of the fine audio offset, in ms (positive = later audio). */
export const AUDIO_OFFSET_KEY = 'ytaf-speed-audio-offset-ms';

export function createSpeedController({ win, getPlayer, notify, configRead }) {
  let currentSpeed = 1;
  let activeSink = null;
  let pending = null;
  let lastReloadAt = 0;
  // Set by index.js: changes the speed of the playing MediaSource in place.
  let liveSwitch = null;
  // Set by index.js: the on-screen countdown of a live speed change.
  let onLiveSwitch = null;
  // A video whose audio the engine could not play: native audio, reload-based.
  let forceNativeId = null;

  function isSupported() {
    return hasAudioCodecs(win);
  }

  function enabled() {
    return configRead('enablePlaybackSpeed') !== false;
  }

  /**
   * The speed a new MediaSource gets. It follows the settings at every call, so
   * turning the option off makes the next videos play at 1x right away.
   */
  function getSpeed() {
    return enabled() && isSupported() ? currentSpeed : 1;
  }

  /**
   * Reloads the current video where it is, so YouTube builds a new MediaSource
   * that picks up the new speed. A player that fails to answer must not break
   * the key handler: without a position the video restarts from the beginning.
   */
  function position(player) {
    try {
      return player.getCurrentTime();
    } catch {
      return 0;
    }
  }

  function videoId() {
    try {
      const p = getPlayer();
      const d = p && p.getVideoData && p.getVideoData();
      return d && d.video_id ? d.video_id : null;
    } catch {
      return null;
    }
  }

  /** Whether new MediaSources go through the speed pipeline even at 1x. */
  function useLive() {
    if (!enabled() || !isSupported()) return false;
    return !forceNativeId || forceNativeId !== videoId();
  }

  function setLiveSwitch(fn, onSwitch = null) {
    liveSwitch = fn;
    onLiveSwitch = onSwitch;
  }

  function scheduleReload(fromSpeed, { forceReload = false } = {}) {
    const player = getPlayer();
    if (!player) return;
    if (pending) {
      win.clearTimeout(pending.timer);
      if (forceReload) pending.forceReload = true;
    } else {
      pending = {
        position: position(player),
        fromSpeed,
        timer: null,
        forceReload
      };
    }
    pending.timer = win.setTimeout(() => {
      const p = pending;
      pending = null;
      applyReload(p);
    }, RELOAD_DELAY_MS);
  }

  function applyReload({ position: pressedAt, fromSpeed, forceReload }) {
    // Back where the burst started: the playing MediaSource is already right.
    if (currentSpeed === fromSpeed && !forceReload) return;
    // Live session: the speed changes at a fragment boundary ahead, no reload.
    if (!forceReload && liveSwitch && liveSwitch(currentSpeed)) return;
    const player = getPlayer();
    if (!player) return;
    // The video kept playing during RELOAD_DELAY_MS: resume where it is now, not
    // where the first press was, or that stretch is played twice. The press
    // position is only the fallback for a player still loading (time 0).
    const nowAt = position(player);
    const at = nowAt > 0 ? nowAt : pressedAt;
    // Keep the user's resolution choice at every speed. Measured on an LG C1
    // (webOS 6): 2160p25 AV1 at 2x and 1080p60 at 2x play with 0 dropped frames.
    const quality = configRead('forceHighResVideo') ? 'highres' : 'auto';
    player.setPlaybackQualityRange(quality, quality);
    const videoData = player.getVideoData && player.getVideoData();
    if (!videoData || !videoData.video_id) return;
    lastReloadAt = Date.now();
    player.loadVideoById(videoData.video_id, at);
    // If YouTube's own menu is bound (native-menu.js), keep what it shows in
    // line with the real speed once the reloaded video has started.
    const setRate = player.__ytafOriginalSetPlaybackRate;
    if (setRate && typeof player.getPlaybackRate === 'function') {
      win.setTimeout(() => {
        try {
          if (player.getPlaybackRate() !== currentSpeed)
            setRate.call(player, currentSpeed);
        } catch {
          // The menu only shows a stale value; playback itself is unaffected.
        }
      }, 2500);
    }
  }

  function setSpeed(speed) {
    if (speed === currentSpeed || !isSupportedSpeed(speed)) return;
    if (!enabled()) {
      notify('Playback speed is disabled in YTAF settings');
      return;
    }
    if (!isSupported()) {
      notify('Playback speed is not supported on this TV');
      return;
    }
    const previousSpeed = currentSpeed;
    currentSpeed = speed;
    // Live session: each press only moves the target speed, so no debounce;
    // the change starts at the next fragment and the countdown shows when.
    if (!pending && liveSwitch && liveSwitch(speed)) {
      if (onLiveSwitch) onLiveSwitch(speed);
      else notify(`Playback speed ${speed}×`);
      return;
    }
    notify(`Playback speed ${speed}×`);
    scheduleReload(pending ? pending.fromSpeed : previousSpeed);
  }

  function cycle() {
    const idx = SPEEDS.indexOf(currentSpeed);
    const nextIdx = (idx + 1) % SPEEDS.length;
    setSpeed(SPEEDS[nextIdx]);
  }

  /**
   * Deliberately ignored: YouTube sets the element's playbackRate back to 1 on
   * every load, and obeying it would undo the speed right after the reload.
   */
  function onRateRequest() {}

  function onError(_err) {
    const id = videoId();
    if (activeSink && id && forceNativeId !== id) {
      // The engine is playing (live sessions use it at 1x too): reload this
      // video with the native audio, at 1x.
      forceNativeId = id;
      const previousSpeed = currentSpeed;
      currentSpeed = 1;
      if (previousSpeed !== 1)
        notify('Playback speed not available for this video');
      scheduleReload(pending ? pending.fromSpeed : previousSpeed, {
        forceReload: true
      });
    } else if (currentSpeed !== 1) {
      const previousSpeed = currentSpeed;
      currentSpeed = 1;
      notify('Playback speed not available for this video');
      scheduleReload(pending ? pending.fromSpeed : previousSpeed);
    }
  }

  /**
   * Stops the Web Audio engine of the previous MediaSource. Needed also when the
   * next one plays at 1x with the native audio: YouTube reuses the same <video>,
   * and an engine left alive keeps following it and plays its buffered audio
   * over the native track (two audio tracks after going back to Normal).
   */
  function releaseAudioSink() {
    if (!activeSink) return;
    activeSink.engine.destroy();
    if (activeSink.element)
      activeSink.element.removeEventListener(
        'volumechange',
        activeSink.listener
      );
    activeSink = null;
  }

  /**
   * Fine A/V offset in ms (positive = later audio), stored by the TV: the
   * output latency of the TV's speakers or receiver is not reported to Web Audio.
   */
  function audioOffsetMs() {
    try {
      const v = win.localStorage && win.localStorage.getItem(AUDIO_OFFSET_KEY);
      return v === null || v === undefined ? 0 : Number(v);
    } catch {
      return 0;
    }
  }

  function createAudioSink({
    speed,
    element,
    speedAt = null,
    contentAhead = null,
    genLimit = null
  }) {
    releaseAudioSink();

    const engine = new AudioEngine({
      win,
      speed,
      onError,
      speedAt,
      contentAhead,
      genLimit,
      getExtraDelayMs: audioOffsetMs,
      leadS: AUDIO_LEAD_S
    });
    if (element) {
      engine.attachVideo(element);
      engine.setVolume(element.volume, element.muted);
      const listener = () => {
        engine.setVolume(element.volume, element.muted);
      };
      element.addEventListener('volumechange', listener);
      activeSink = { engine, element, listener };
    } else {
      activeSink = { engine, element: null, listener: null };
    }
    return engine;
  }

  function handleKey(evt) {
    // YTAF's ui.js reads colour keys from charCode, the webOS docs from keyCode:
    // accept both.
    const code = evt.keyCode || evt.charCode;
    if (code === 405 || code === 170) {
      const player = getPlayer();
      if (
        evt.defaultPrevented ||
        !player?.getVideoData?.()?.video_id ||
        player.isInline?.()
      ) {
        return false;
      }
      if (evt.type === 'keydown') {
        evt.preventDefault();
        if (evt.stopPropagation) evt.stopPropagation();
        // YouTube re-dispatches remote keys from its own listeners on document
        // (seen on the TV: one press cycled twice); ours runs first, so stop them.
        if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
        cycle();
        return true;
      } else if (evt.type === 'keypress' || evt.type === 'keyup') {
        evt.preventDefault();
        return true;
      }
    }
    return false;
  }

  return {
    /** The engine playing the current video, for diagnostics from DevTools. */
    activeEngine: () => (activeSink ? activeSink.engine : null),
    lastReloadAt: () => lastReloadAt,
    isSupported,
    useLive,
    setLiveSwitch,
    getSpeed,
    setSpeed,
    cycle,
    onRateRequest,
    onError,
    createAudioSink,
    releaseAudioSink,
    handleKey
  };
}
