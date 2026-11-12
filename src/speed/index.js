import { createSpeedController } from './controller.js';
import { installMseHook } from './mse-hook.js';
import {
  enableNativeSpeedMenu,
  bindPlayerRate,
  hookRateAssignments
} from './native-menu.js';
import { installSpeedButtonPatch } from './speed-button.js';

export function supportsPlaybackSpeed(win) {
  return (
    typeof win.AudioDecoder === 'function' &&
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
    onNativeAudio: controller.releaseAudioSink
  });

  // YouTube's own "Playback speed" menu: enabled in the player config, and bound
  // to the controller on every player instance that appears.
  const restoreMenu = enableNativeSpeedMenu(win);
  const restoreRateHook = hookRateAssignments(win, controller);
  const restoreButton = installSpeedButtonPatch(win);
  const bindTimer =
    typeof win.setInterval === 'function'
      ? win.setInterval(() => bindPlayerRate(getPlayer(), controller), 1000)
      : null;

  const keyHandler = (evt) => {
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

  return { controller, uninstall };
}
