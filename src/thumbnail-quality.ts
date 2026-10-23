/**
 * Upgrade the thumbnails YouTube asks for (320x180 crops of `hqdefault`) to
 * `sddefault` (640x480) in the InnerTube responses, before they are rendered.
 *
 * This used to be done in the DOM: a `MutationObserver` on every style change
 * under `<body>`, and a second image load for each thumbnail. On a 2017 LG
 * (webOS 3.9) that made every page switch about 1 s slower (the observer about
 * 0.6 s, the second loads about 0.5 s). Rewriting the URLs in the data costs a
 * few ms per response.
 */

import { configRead } from './config';

let webpSupported = false;
const webpTest = new Image();
webpTest.onload = () => {
  webpSupported = webpTest.width > 0 && webpTest.height > 0;
};
webpTest.src =
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

// Only i.ytimg.com: the A/B test hosts (i1, i2, ...) are left alone, as before.
// `_live` thumbnails have their own `sddefault`; the other suffixes
// (`_custom_1`, ...) do not, so they get the video's own `sddefault`.
const YT_THUMBNAIL_URL =
  /^(https:\/\/i\.ytimg\.com)\/vi(?:_webp)?\/([^/]+)\/(?:sd|hq|mq)?default(_live)?(?:_\w+)?\.(?:jpg|webp)(?:\?.*)?$/;

function upgradeURL(url: string) {
  const match = YT_THUMBNAIL_URL.exec(url);
  if (!match) return null;
  const [, host, videoId, live = ''] = match;
  return webpSupported
    ? `${host}/vi_webp/${videoId}/sddefault${live}.webp`
    : `${host}/vi/${videoId}/sddefault${live}.jpg`;
}

function upgradeIn(node: unknown) {
  if (typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) {
    for (const item of node) upgradeIn(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.thumbnails)) {
    for (const thumbnail of obj.thumbnails as { url?: unknown }[]) {
      if (typeof thumbnail?.url !== 'string') continue;
      const url = upgradeURL(thumbnail.url);
      if (url) thumbnail.url = url;
    }
  }
  for (const key in obj) upgradeIn(obj[key]);
}

/** Upgrade the video thumbnails in a parsed InnerTube response, in place. */
function upgradeThumbnails(r: unknown) {
  if (!configRead('upgradeThumbnails')) return;
  if ((r as { responseContext?: unknown } | null)?.responseContext == null)
    return;
  upgradeIn(r);
}

const origParse = JSON.parse;
JSON.parse = function (text, reviver) {
  const r: unknown = origParse.call(JSON, text, reviver);
  upgradeThumbnails(r);
  return r;
};
