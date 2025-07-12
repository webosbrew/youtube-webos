import { configRead } from './config';
import { getPlayer, PlayerState } from './player-api';
import { showNotification } from './ui';

let player = await getPlayer();
let timeout: number | null = null;
let shouldNotify: boolean = false;

// `showNotification` with a debounce
function notify(message: string) {
  if (timeout) clearTimeout(timeout);

  timeout = window.setTimeout(() => {
    showNotification(message);
    timeout = null;
  }, 750);
}

function handlePlayerStateChange(state: PlayerState) {
  if (!configRead('forceHighResVideo')) return;

  switch (state) {
    case PlayerState.CUED:
      shouldNotify = true;
      player.setPlaybackQualityRange('highres', 'highres');
      break;
    case PlayerState.PLAYING: {
      if (!shouldNotify) return;

      const selected = player.getPlaybackQualityLabel();
      const max = player.getAvailableQualityData()[0]?.qualityLabel;
      notify(`${selected} selected (Max ${max})`);
      shouldNotify = false;
      break;
    }
  }
}

player.addEventListener('onStateChange', handlePlayerStateChange);
