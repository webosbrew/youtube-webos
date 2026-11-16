/**
 * Removes the shopping QR-code cards ("timely actions") that YouTube shows in
 * the player overlay of regular videos.
 *
 * Ported from NicholasBly's youtube-webos fork (GPL-3.0):
 * https://github.com/NicholasBly/youtube-webos
 * - `removeTimelyActions`: src/features/adblock/response-filters.js
 * - `atPathOrSearch`, `findObjects`: src/features/adblock/search.js
 * - `getByPath`, `overlayPath`: src/core/innertube.js
 * - `boundedSearch`: src/core/bounded-search.js
 */
import { configRead } from './config';

type JSONObject = Record<string, unknown>;
type ResponseType = 'PLAYER' | 'NEXT';

const overlayPath = ['playerOverlays', 'playerOverlayRenderer'];

/** The value at `parts` under `obj`, or undefined when any step is missing. */
function getByPath(obj: unknown, parts: string[]): unknown {
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current == null) return undefined;
    current = (current as JSONObject)[parts[i]!];
  }
  return current;
}

/**
 * Visits every object under `root` (itself included) breadth first, down to
 * `maxDepth` levels below it, until `visit(node)` returns true.
 */
function boundedSearch(
  root: object,
  maxDepth: number,
  visit: (node: JSONObject) => boolean
) {
  const queue: unknown[] = [root, 0];
  let i = 0;
  while (i < queue.length) {
    const node = queue[i++] as JSONObject;
    const depth = queue[i++] as number;
    if (visit(node)) return;
    const nextDepth = depth + 1;
    if (nextDepth > maxDepth) continue;
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') queue.push(v, nextDepth);
    }
  }
}

/** The first value found for `needle`, searching breadth-first down to `maxDepth`. */
function findObject(haystack: unknown, needle: string, maxDepth: number) {
  if (!haystack || typeof haystack !== 'object' || maxDepth <= 0) {
    return undefined;
  }
  let result: unknown;
  boundedSearch(haystack, maxDepth, (node) => {
    if (node[needle] !== undefined) {
      result = node[needle];
      return true;
    }
    return false;
  });
  return result;
}

/**
 * The object at `path`, or when the path misses the first `needle` found by a
 * bounded search.
 */
function atPathOrSearch(
  data: unknown,
  path: string[],
  needle: string,
  depth: number,
  label: string
) {
  const direct = getByPath(data, path);
  if (direct) return direct;
  const found = findObject(data, needle, depth);
  if (!found) return undefined;
  console.debug(`${label}: ${needle} found by search, not at its path`);
  return found;
}

/**
 * The QR-code prompt in the player overlay, found along the path, or on NEXT
 * by search when the path misses. A player response is parsed at every video
 * start and keeps its overlay at the path; a search over it would be a walk
 * of the whole streaming data for nothing.
 */
function removeTimelyActions(data: unknown, responseType: ResponseType) {
  const overlay = (
    responseType === 'NEXT'
      ? atPathOrSearch(
          data,
          overlayPath,
          'playerOverlayRenderer',
          8,
          responseType
        )
      : getByPath(data, overlayPath)
  ) as JSONObject | undefined;
  if (overlay?.timelyActionRenderers) {
    delete overlay.timelyActionRenderers;
    console.debug(`${responseType}: Removed timelyActionRenderers (QR Code)`);
  }
}

/** PLAYER or NEXT, by the same signatures as NicholasBly's schema registry. */
function detectResponseType(data: unknown): ResponseType | null {
  if (getByPath(data, ['streamingData']) !== undefined) return 'PLAYER';
  if (
    getByPath(data, ['contents', 'singleColumnWatchNextResults']) !== undefined
  ) {
    return 'NEXT';
  }
  return null;
}

type JSONReviver = Parameters<typeof JSON.parse>[1];

const originalParse = JSON.parse;

function jsonParse(str: string, reviver?: JSONReviver) {
  const res = originalParse(str, reviver) as unknown;

  if (!configRead('hideShoppingOverlays')) {
    return res;
  }

  const responseType = detectResponseType(res);
  if (responseType) removeTimelyActions(res, responseType);

  return res;
}

JSON.parse = jsonParse;
