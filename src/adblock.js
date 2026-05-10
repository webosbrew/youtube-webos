/* eslint no-redeclare: 0 */
/* global fetch:writable */
import { configRead } from './config';

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/master/filters/filters.txt
 */
const origParse = JSON.parse;
JSON.parse = function () {
  /** @type {unknown} */
  const r = origParse.apply(this, arguments);

  // TODO: add below to a dump-level logger
  // if (
  //   !(Object.keys(r).length === 1 && 'data' in r && typeof r.data === 'boolean')
  // ) {
  //   console.debug('JSON.parse', r);
  // }

  if (!configRead('enableAdBlock')) {
    return r;
  }

  if (r?.adPlacements) {
    delete r.adPlacements;
    console.info('[adblock] Removed adPlacements');
  }

  if (Array.isArray(r?.adSlots)) {
    delete r.adSlots;
    console.info('[adblock] Removed adSlots');
  }

  if (r?.playerAds) {
    delete r.playerAds;
    console.info('[adblock] Removed playerAds');
  }

  // remove ads from home
  const homeSectionListRenderer =
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer;
  if (homeSectionListRenderer?.contents) {
    // Drop the full width ad card, usually appears at the top of the page
    homeSectionListRenderer.contents = homeSectionListRenderer.contents.filter(
      (elm) => !elm.tvMastheadRenderer
    );

    // Drop ad tile from the horizontal shelf
    removeAdSlotRenderer(homeSectionListRenderer);
  }

  // remove ad tile from search
  const searchSectionListRenderer = r?.contents?.sectionListRenderer;
  if (searchSectionListRenderer?.contents) {
    removeAdSlotRenderer(searchSectionListRenderer);
  }

  if (Array.isArray(r?.entries)) {
    r.entries = r.entries.filter(
      (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
    );
  }

  return r;
};

// Drop `adSlotRenderer`
// `adSlotRenderer` can occur as,
// - sectionListRenderer.contents[*].adSlotRenderer
// - sectionListRenderer.contents[*].shelfRenderer.content.horizontalListRenderer.items[*].adSlotRenderer
function removeAdSlotRenderer(sectionListRenderer) {
  // sectionListRenderer.contents[*].adSlotRenderer
  sectionListRenderer.contents = sectionListRenderer.contents.filter(
    (elm) => !elm.adSlotRenderer
  );

  // sectionListRenderer.contents[*].shelfRenderer.content.horizontalListRenderer.items[*].adSlotRenderer
  const contentsWithShelfRenderer = sectionListRenderer.contents.filter(
    (elm) => elm.shelfRenderer
  );
  contentsWithShelfRenderer.forEach((content) => {
    const horizontalRenderer =
      content.shelfRenderer.content.horizontalListRenderer;
    horizontalRenderer.items = horizontalRenderer.items.filter(
      (elm) => !elm.adSlotRenderer
    );
  });
}
