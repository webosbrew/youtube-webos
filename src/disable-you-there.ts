/**
 * Disables YouTube's "Continue watching?" auto-pause prompt.
 *
 * 1. YouTube TV reads the prompt from `messages[].youThereRenderer` of the
 *    player response, so it is pruned from every parsed JSON response.
 * 2. As a fallback, while a video is playing the last-activity timestamp
 *    (`window._lact`) is kept fresh so the idle timer never expires.
 */

import { configRead } from './config';

type JSONReviver = Parameters<typeof JSON.parse>[1];

function pruneYouThere(obj: unknown) {
  if (obj === null || typeof obj !== 'object') return;
  const messages = (obj as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return;

  const filtered = messages.filter(
    (m) => !(m !== null && typeof m === 'object' && 'youThereRenderer' in m)
  );
  if (filtered.length !== messages.length) {
    (obj as { messages: unknown[] }).messages = filtered;
    console.info('[you-there] Removed youThereRenderer');
  }
}

const originalParse = JSON.parse;

function jsonParse(str: string, reviver?: JSONReviver) {
  const res = originalParse(str, reviver) as unknown;

  if (!configRead('disableYouThere')) return res;

  pruneYouThere(res);
  if (res !== null && typeof res === 'object') {
    // Player response can also be nested inside a "next"/watch response.
    pruneYouThere((res as { playerResponse?: unknown }).playerResponse);
  }

  return res;
}

JSON.parse = jsonParse;

const w = window as unknown as { _lact?: number };

setInterval(() => {
  if (!configRead('disableYouThere')) return;

  const video = document.querySelector('video');
  if (video && !video.paused && !video.ended && typeof w._lact === 'number') {
    w._lact = Date.now();
  }
}, 60_000);
