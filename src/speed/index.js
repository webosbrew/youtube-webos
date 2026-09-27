import { createSpeedController } from './controller.js';
import { installMseHook } from './mse-hook.js';
import {
  enableNativeSpeedMenu,
  bindPlayerRate,
  hookRateAssignments
} from './native-menu.js';
import { installSpeedButtonPatch } from './speed-button.js';

export function installSpeedFeature(win, { notify, configRead, getPlayer }) {
  if (
    typeof win.AudioDecoder === 'undefined' ||
    typeof win.AudioContext === 'undefined' ||
    typeof win.MediaSource === 'undefined'
  ) {
    return null;
  }

  const controller = createSpeedController({
    win,
    getPlayer,
    notify,
    configRead
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
  const restoreButton = installSpeedButtonPatch(
    win,
    () => configRead('enablePlaybackSpeed') !== false
  );
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
