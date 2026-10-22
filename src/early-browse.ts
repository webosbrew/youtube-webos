/**
 * YouTube's page now fetches the home screen itself, in an inline script that
 * runs before the user script is injected: `window.pendingEarlyBrowse` is set
 * about 0.5 s after the page starts and resolves about 2.5 s in, parsed with
 * the native `JSON.parse`. webOS injects the user script only about 3 s in, so
 * the `JSON.parse` hooks in `adblock.js` and `shorts.js` never see this first
 * home screen: its ad tiles ("Sponsored") lead the first shelf, and the
 * background, which follows the focused tile, shows the ad too. The app takes
 * the response about 4 s in, so there is time to filter it in place.
 *
 * Only fresh starts fetch it: a preloaded launch (`launch=preload`) skips it,
 * which is why the ads come back only "sometimes" (see #370).
 */

import { removeAds } from './adblock.js';
import { removeShortsFrom } from './shorts.js';

window.pendingEarlyBrowse?.then(
  (early) => {
    if (!early?.response) return;
    removeAds(early.response);
    removeShortsFrom(early.response);
    console.info('[early-browse] Filtered the early home screen');
  },
  // The page handles its own failure
  () => {}
);
