import { get } from 'http';
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

function setPlaybackQuality(this: PlayerManager, _: unknown) {
  if (this.playerMode === PlayerMode.PREVIEW) return;

  console.debug('[video-quality] setting playback quality');
  this.removeEventListener('playbackStart', setPlaybackQuality);

  const prevQuality = this.player.getPlaybackQualityLabel();
  this.player.setPlaybackQualityRange('highres', 'highres');

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
