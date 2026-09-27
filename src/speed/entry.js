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
