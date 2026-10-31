import { configRead } from './config';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager, VideoID } from './player_api';
import { showNotification } from './ui';

const playerManager = await getPlayerManager();

function shouldForce() {
  return configRead('forceHighResVideo');
}

type EventMap = EventMapOf<PlayerManager>;

function getMaxQualityLabel(player: PlayerManager['player']) {
  return player.getAvailableQualityData()[0]?.qualityLabel;
}

function notifyPlaybackQuality(this: PlayerManager) {
  if (!shouldForce()) return;

  const player = this.player;

  const selected = player.getPlaybackQualityLabel();
  const max = getMaxQualityLabel(player);

  showNotification(`${selected} selected (Max ${max})`, 3000);

  this.removeEventListener('playbackStart', notifyPlaybackQuality);
}

/**
 * Changing the quality range makes YouTube reload the `<video>` element. On
 * webOS 25, the reloaded element sometimes does not seek back to the playback
 * position: the player keeps buffering around the position while the element
 * waits at 0, so the video never starts. This happens when playback resumes
 * from a non-zero position, e.g. when a video is opened from its home screen
 * preview or resumed from the watch history.
 *
 * If the element is still out of sync after it has loaded, seek it back to the
 * position reported by the player.
 */
function restorePositionAfterReload(player: PlayerManager['player']) {
  const video = player.querySelector('video');
  if (!video) return;

  const videoID = player.getVideoData().video_id;
  const startTime = Date.now();
  let stalledChecks = 0;

  const intervalToken = window.setInterval(() => {
    if (
      Date.now() - startTime > 15000 ||
      player.getVideoData().video_id !== videoID
    ) {
      clearInterval(intervalToken);
      return;
    }

    const position = player.getCurrentTime();
    const isStalled =
      !video.seeking &&
      video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA &&
      position > 1 &&
      Math.abs(video.currentTime - position) > 1;

    if (!isStalled) {
      stalledChecks = 0;
      return;
    }

    // Leave the player a chance to seek on its own first.
    if (++stalledChecks < 2) return;

    clearInterval(intervalToken);
    console.warn(
      `[video-quality] restoring playback position (${video.currentTime} -> ${position})`
    );
    video.currentTime = position;
  }, 500);
}

function setPlaybackQuality(this: PlayerManager, _: unknown) {
  if (this.playerMode === PlayerMode.PREVIEW) return;

  console.debug('[video-quality] setting playback quality');
  this.removeEventListener('playbackStart', setPlaybackQuality);

  const prevQuality = this.player.getPlaybackQualityLabel();
  this.player.setPlaybackQualityRange('highres', 'highres');
  restorePositionAfterReload(this.player);

  if (prevQuality === getMaxQualityLabel(this.player)) {
    notifyPlaybackQuality.call(this);
    return;
  }

  let timeoutToken: number | undefined;

  // No reliable event for quality change, so poll for it
  const intervalToken = window.setInterval(() => {
    const currQuality = this.player.getPlaybackQualityLabel();
    if (currQuality !== prevQuality) {
      notifyPlaybackQuality.call(this);
      clearInterval(intervalToken);
      clearTimeout(timeoutToken);
    }
  }, 100);

  timeoutToken = window.setTimeout(() => {
    console.warn('[video-quality] timed out waiting for quality change');
    clearInterval(intervalToken);
    notifyPlaybackQuality.call(this);
  }, 3000);
}

function handleNewVideo(this: PlayerManager, _: EventMap['newVideo']) {
  if (!shouldForce()) return;

  this.removeEventListener('playbackStart', setPlaybackQuality);
  this.addEventListener('playbackStart', setPlaybackQuality);
}

playerManager.addEventListener('newVideo', handleNewVideo);
