/* eslint no-redeclare: 0 */
/* global fetch:writable */
import { configRead } from './config';

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/3497eebd440f4871830b9b45af0afc406c6eb593/filters/filters.txt#L116
 *
 * This in turn calls the following snippet:
 * https://github.com/gorhill/uBlock/blob/bfdc81e9e400f7b78b2abc97576c3d7bf3a11a0b/assets/resources/scriptlets.js#L365-L470
 *
 * Seems like for now dropping just the adPlacements is enough for YouTube TV
 */
const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {
    if (r.adPlacements && configRead('enableAdBlock')) {
      r.adPlacements = [];
    }

    // Drop "masthead" ad from home screen
    if (
      r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
        ?.sectionListRenderer?.contents &&
      configRead('enableAdBlock')
    ) {
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents
          .filter((elm) => !elm.tvMastheadRenderer)
          .map((elm) => {
            // Drop recommended video tiles
            if (elm?.shelfRenderer?.content?.horizontalListRenderer?.items) {
              elm.shelfRenderer.content.horizontalListRenderer.items =
                elm.shelfRenderer.content.horizontalListRenderer.items.filter(
                  (item) =>
                    !item?.tileRenderer?.metadata?.tileMetadataRenderer
                      ?.lines ||
                    !item?.tileRenderer?.metadata?.tileMetadataRenderer
                      ?.lines[0]?.lineRenderer?.items ||
                    item?.tileRenderer?.metadata?.tileMetadataRenderer?.lines[0]
                      ?.lineRenderer?.items[0]?.lineItemRenderer?.badge
                      ?.metadataBadgeRenderer?.style !== 'BADGE_STYLE_TYPE_AD'
                );
            }

            return elm;
          });
    }
  } catch (err) {
    console.warn(
      'adblock: an error occured during JSON.parse processing:',
      err
    );
  }

  return r;
};
