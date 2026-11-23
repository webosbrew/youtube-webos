import { createSpeedController } from './controller.js';
import { installMseHook } from './mse-hook.js';
import {
  enableNativeSpeedMenu,
  bindPlayerRate,
  hookRateAssignments
} from './native-menu.js';
import { installSpeedButtonPatch } from './speed-button.js';
import { hasAudioCodecs } from './legacy-decoder.js';
import { createSpeedToast } from './speed-toast.js';
import { createSyncOverlay } from './sync-overlay.js';

export function supportsPlaybackSpeed(win) {
  return (
    hasAudioCodecs(win) &&
    typeof win.AudioContext === 'function' &&
    typeof win.MediaSource === 'function'
  );
}

export function installSpeedFeature(win, { notify, configRead, getPlayer }) {
  if (!supportsPlaybackSpeed(win) || !configRead('enablePlaybackSpeed')) {
    return null;
  }

  const controller = createSpeedController({
    win,
    getPlayer,
    notify,
    // The media and player hooks are installed before YouTube initializes.
    configRead: (key) => key === 'enablePlaybackSpeed' || configRead(key)
  });
  const mseHook = installMseHook(win, {
    getSpeed: controller.getSpeed,
    createAudioSink: controller.createAudioSink,
    onRateRequest: controller.onRateRequest,
    onError: controller.onError,
    onNativeAudio: controller.releaseAudioSink,
    useLive: controller.useLive
  });
  const toast =
    win.document && typeof win.document.createElementNS === 'function'
      ? createSpeedToast(win, mseHook.switchStatus)
      : null;
  controller.setLiveSwitch(
    mseHook.switchSpeed,
    toast ? (speed) => toast.show(speed) : null
  );

  // YouTube's own "Playback speed" menu: enabled in the player config, and bound
  // to the controller on every player instance that appears.
  const restoreMenu = enableNativeSpeedMenu(win);
  const restoreRateHook = hookRateAssignments(win, controller);
  const restoreButton = installSpeedButtonPatch(win);
  const bindTimer =
    typeof win.setInterval === 'function'
      ? win.setInterval(() => {
          bindPlayerRate(getPlayer(), controller);
          // A new video starts at YouTube's 1x even when it plays faster.
          controller.syncPlayerRate();
        }, 1000)
      : null;

  // RED: audio sync pill, adjusted while watching the picture.
  const syncOverlay =
    win.document && typeof win.document.createElement === 'function'
      ? createSyncOverlay(win, {
          getPlayer,
          onChange: () => controller.resyncAudio()
        })
      : null;

  const keyHandler = (evt) => {
    if (syncOverlay && syncOverlay.handleKey(evt)) return;
    controller.handleKey(evt);
  };

  // Register in capture phase
  win.document.addEventListener('keydown', keyHandler, true);
  win.document.addEventListener('keypress', keyHandler, true);
  win.document.addEventListener('keyup', keyHandler, true);

  function uninstall() {
    mseHook.uninstall();
    controller.releaseAudioSink();
    restoreMenu();
    restoreRateHook();
    restoreButton();
    if (bindTimer !== null) win.clearInterval(bindTimer);
    win.document.removeEventListener('keydown', keyHandler, true);
    win.document.removeEventListener('keypress', keyHandler, true);
    win.document.removeEventListener('keyup', keyHandler, true);
  }

  return { controller, uninstall, mseHook };
}
