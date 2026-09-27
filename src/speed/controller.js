import { AudioEngine } from './audio-engine.js';
import { isSupportedSpeed } from './timemap.js';

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

/**
 * How long to wait after the last speed change before reloading the video.
 * Measured on the TV (LG OLED C4, webOS 24): pressing YELLOW several times to reach 2x
 * reloaded the video at every press, and a reload started while the previous
 * one was loading read getCurrentTime() = 0, so the position was lost. One
 * reload per burst of presses, at the position of the first press, fixes both.
 */
export const RELOAD_DELAY_MS = 800;

export function createSpeedController({ win, getPlayer, notify, configRead }) {
  let currentSpeed = 1;
  let activeSink = null;
  let pending = null;
  let lastReloadAt = 0;

  function isSupported() {
    return typeof win.AudioDecoder !== 'undefined';
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

  function scheduleReload(fromSpeed) {
    const player = getPlayer();
    if (!player) return;
    if (pending) {
      win.clearTimeout(pending.timer);
    } else {
      pending = { position: position(player), fromSpeed, timer: null };
    }
    pending.timer = win.setTimeout(() => {
      const p = pending;
      pending = null;
      applyReload(p);
    }, RELOAD_DELAY_MS);
  }

  function applyReload({ position: at, fromSpeed }) {
    // Back where the burst started: the playing MediaSource is already right.
    if (currentSpeed === fromSpeed) return;
    const player = getPlayer();
    if (!player) return;
    if (currentSpeed > 1.25) {
      player.setPlaybackQualityRange('hd1080', 'hd1080');
    } else if (fromSpeed > 1.25) {
      const quality = configRead('forceHighResVideo') ? 'highres' : 'auto';
      player.setPlaybackQualityRange(quality, quality);
    }
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
    if (currentSpeed !== 1) {
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

  function createAudioSink({ speed, element }) {
    releaseAudioSink();

    const engine = new AudioEngine({ win, speed, onError });
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
