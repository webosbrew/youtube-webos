import { installSpeedFeature } from './index.js';
import { showNotification } from '../ui.js';
import { configRead } from '../config.js';

const speed = installSpeedFeature(window, {
  notify: showNotification,
  configRead: configRead,
  getPlayer: () => document.querySelector('.html5-video-player')
});

// Reachable from DevTools, like window.ytaf_showOptionsPanel in ui.js.
window.ytafSpeed = speed ? speed.controller : null;
window.ytafSpeedHook = speed ? speed.mseHook : null;

// "Force max resolution" stays in effect at every speed: on an LG C1 (webOS 6)
// 2160p25 at 2x plays with 0 dropped frames, as it did in the official app.
export function isPlaybackSpeedLimited() {
  return false;
}
