import {
  CustomEventTarget,
  TypedCustomEvent,
  type EventMapOf
} from '../custom-event-target';
import { getPlayer } from './helpers';
import type { PlayerStateObject, VideoID, YTPlayer } from './yt-api';

function diffPlayerState(
  prev: PlayerStateObject | null,
  next: PlayerStateObject
) {
  if (!prev) return next;

  const changes: Partial<PlayerStateObject> = {};

  for (const k in next) {
    const key = k as keyof PlayerStateObject;
    if (next[key] !== prev[key]) {
      changes[key] = next[key];
    }
  }

  return changes;
}

interface EventMap {
  newVideo: CustomEvent<VideoID>;
  playbackStart: CustomEvent<undefined>;
}

export enum PlayerMode {
  PREVIEW,
  SHORTS,
  NORMAL
}

class PlayerManager
  extends CustomEventTarget<EventMap>
  implements PlayerManager
{
  #player;
  #lastVideoID: VideoID | null = null;
  #lastPlayerState: PlayerStateObject | null = null;
  #playbackStartFired = false;

  #handleNewVideo(videoID: VideoID) {
    this.#playbackStartFired = false;
    this.dispatchEvent(new TypedCustomEvent('newVideo', { detail: videoID }));
  }

  #handlePlayerStateChange = () => {
    const current = this.#player.getPlayerStateObject();
    const diff = diffPlayerState(
      this.#lastPlayerState,
      this.#player.getPlayerStateObject()
    );
    this.#lastPlayerState = current;

    const currentVideoID = this.currentVideoID;
    if (this.#lastVideoID !== currentVideoID) {
      if (!currentVideoID) throw new Error('unexpected `null` video ID');
      this.#handleNewVideo(currentVideoID);
      this.#lastVideoID = currentVideoID;
    }

    if (diff.isPlaying && !this.#playbackStartFired) {
      this.#playbackStartFired = true;
      this.dispatchEvent(new TypedCustomEvent('playbackStart'));
    }
  };

  constructor(player: YTPlayer) {
    super();
    this.#player = player;

    player.addEventListener('onStateChange', this.#handlePlayerStateChange);
  }

  get currentVideoID(): VideoID | null {
    return this.#player.getVideoData().video_id || null;
  }

  get playerMode() {
    if (this.#player.isInline()) return PlayerMode.PREVIEW;

    if (this.#player.getVideoStats().el === 'shortspage') {
      return PlayerMode.SHORTS;
    }

    return PlayerMode.NORMAL;
  }

  get player(): YTPlayer {
    return this.#player;
  }
}

let instance: PlayerManager | null = null;

export async function getPlayerManager(): Promise<PlayerManager> {
  if (!instance) {
    const player = await getPlayer();
    instance = new PlayerManager(player);
  }

  instance.addEventListener('playbackStart', function (event) {
    event.type;
    event.currentTarget?.currentVideoID;
    event.detail;
  });

  return instance;
}

export type { PlayerManager };
