/* eslint no-redeclare: 0 */
/* global fetch:writable */
import { configRead } from './config';

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  if (!configRead('removeShorts')) {
    return r;
  }

  // First page of subscriptions tab
  const gridRenderer =
    r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections[0]
      ?.tvSecondaryNavSectionRenderer?.tabs[0]?.tabRenderer?.content
      ?.tvSurfaceContentRenderer?.content?.gridRenderer;

  if (gridRenderer?.items) {
    removeShorts(gridRenderer);
  }

  // Pagination
  const gridContinuation = r?.continuationContents?.gridContinuation;
  if (gridContinuation?.items) {
    removeShorts(gridContinuation);
  }

  return r;
};

function removeShorts(gridRenderer) {
  gridRenderer.items = gridRenderer.items.filter(
    (elm) => elm?.tileRenderer?.onSelectCommand?.reelWatchEndpoint == null
  );
}
