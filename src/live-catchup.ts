import { configRead } from './config';
import { getPlayerManager } from './player_api';
import { showNotification } from './ui';

const MARGIN_MIN = 1.5;
const MARGIN_MAX = 8;
const MARGIN_GROW = 1.5;
const MARGIN_DECAY = 0.5;
const STABLE_WINDOW_MS = 30000;

const TRIGGER_OVER_MARGIN = 8;
const OPEN_SETTLE_MS = 3000;
const OPEN_TRIGGER_OVER_MARGIN = 2;

const playerManager = await getPlayerManager();
const player = playerManager.player;

let uiSeekSeen = false;
let suspended = false;
let openedAt: number | null = null;
let openSkipDone = false;

let margin = 2;
let wasBuffering = false;
let lastMarginChange = Date.now();

let selfSeek = false;
let lastKnownTime = 0;

playerManager.addEventListener('newVideo', () => {
  uiSeekSeen = false;
  suspended = false;
  openedAt = null;
  openSkipDone = false;
});

document.addEventListener(
  'seeking',
  (evt) => {
    if (!(evt.target instanceof HTMLVideoElement)) return;
    if (selfSeek) {
      selfSeek = false;
      return;
    }
    if (!configRead('enableLiveCatchup') || !player.getVideoData().isLive) {
      return;
    }

    const backward = lastKnownTime - evt.target.currentTime;
    if (
      player.getPlayerStateObject().isUiSeeking ||
      (openSkipDone && backward > 3)
    ) {
      uiSeekSeen = true;
    }
  },
  true
);

function liveEdge(video: HTMLVideoElement): number {
  const buffered = video.buffered;
  const seekable = video.seekable;
  const bufEnd = buffered.length ? buffered.end(buffered.length - 1) : 0;
  const seekEnd = seekable.length ? seekable.end(seekable.length - 1) : 0;
  return seekEnd > bufEnd && seekEnd - bufEnd < 120 ? seekEnd : bufEnd;
}

function skipToEdge(video: HTMLVideoElement, edge: number, ahead: number) {
  console.info('[live-catchup] behind', ahead.toFixed(1), 's, seeking');
  selfSeek = true;
  video.currentTime = edge - margin;
  showNotification(
    `Live catch-up: skipped ${(ahead - margin).toFixed(0)}s to live edge`
  );
}

function adaptMargin(state: { isBuffering: boolean; isSeeking: boolean }) {
  const stalled = state.isBuffering && !state.isSeeking;

  if (stalled && !wasBuffering && openSkipDone && !suspended) {
    margin = Math.min(margin + MARGIN_GROW, MARGIN_MAX);
    lastMarginChange = Date.now();
    console.info('[live-catchup] stall, margin now', margin);
  } else if (
    margin > MARGIN_MIN &&
    Date.now() - lastMarginChange > STABLE_WINDOW_MS
  ) {
    margin = Math.max(MARGIN_MIN, margin - MARGIN_DECAY);
    lastMarginChange = Date.now();
    console.info('[live-catchup] stable, margin now', margin);
  }

  wasBuffering = stalled;
}

function tick() {
  if (!configRead('enableLiveCatchup') || !player.getVideoData().isLive) {
    return;
  }

  const state = player.getPlayerStateObject();
  if (state.isUiSeeking) uiSeekSeen = true;
  adaptMargin(state);
  if (!state.isPlaying || state.isSeeking) return;

  const video = player.querySelector('video');
  if (!video || video.buffered.length === 0) return;

  const edge = liveEdge(video);
  const ahead = edge - video.currentTime;
  lastKnownTime = video.currentTime;

  if (uiSeekSeen) {
    uiSeekSeen = false;
    const wantsDvr = ahead > margin + TRIGGER_OVER_MARGIN;
    if (wantsDvr !== suspended) {
      suspended = wantsDvr;
      console.info('[live-catchup]', suspended ? 'suspended' : 'resumed');
      showNotification(
        suspended
          ? 'Live catch-up paused (manual seek)'
          : 'Live catch-up resumed'
      );
    }
    return;
  }

  if (suspended) return;

  if (!openSkipDone) {
    openedAt ??= Date.now();
    if (Date.now() - openedAt < OPEN_SETTLE_MS) return;
    openSkipDone = true;
    if (ahead > margin + OPEN_TRIGGER_OVER_MARGIN) {
      skipToEdge(video, edge, ahead);
    }
    return;
  }

  if (ahead > margin + TRIGGER_OVER_MARGIN) skipToEdge(video, edge, ahead);
}

window.setInterval(tick, 500);
