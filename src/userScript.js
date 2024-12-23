import 'whatwg-fetch';
import './domrect-polyfill';

import { handleLaunch } from './utils';

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    console.info('RELAUNCH:', evt, window.launchParams);
    handleLaunch(evt.detail);
  },
  true
);

import './adblock.js';
import './shorts.js';
import './sponsorblock.js';
import './ui.js';
import './screensaver-fix';
import './thumbnail-quality';
