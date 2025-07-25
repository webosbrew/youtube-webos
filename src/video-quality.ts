import { configRead } from './config';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager, VideoID } from './player_api';
import { showNotification } from './ui';

const playerManager = await getPlayerManager();

function shouldForce() {
  return (
    configRead('forceHighResVideo') &&
    playerManager.playerMode !== PlayerMode.PREVIEW
  );
}

type EventMap = EventMapOf<PlayerManager>;

function handleNewVideo(this: PlayerManager, _: EventMap['newVideo']) {
  if (!shouldForce()) return;

  this.player.setPlaybackQualityRange('highres', 'highres');
}

function handlePlaybackStart(
  this: PlayerManager,
  _: EventMap['playbackStart']
) {
  if (!shouldForce()) return;

  const player = this.player;

  const selected = player.getPlaybackQualityLabel();
  const max = player.getAvailableQualityData()[0]?.qualityLabel;

  showNotification(`${selected} selected (Max ${max})`, 3000);
}

playerManager.addEventListener('newVideo', handleNewVideo);
playerManager.addEventListener('playbackStart', handlePlaybackStart);
