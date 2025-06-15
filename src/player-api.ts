import { waitForChildAdd } from './utils';

export enum PlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5
}

interface YTPlayerEventMap extends HTMLElementEventMap {
  onStateChange: PlayerState;
}

interface VideoQualityData {
  formatId: string | undefined;
  qualityLabel: string;
  quality: string;
  isPlayable: boolean;
  paygatedQualityDetails?: unknown;
}

export interface YTPlayer extends HTMLElement {
  addEventListener<K extends keyof YTPlayerEventMap>(
    type: K,
    listener: (this: YTPlayer, ev: YTPlayerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  // Player API does not support `removeEventListener`

  getPlaybackQualityLabel(): string;

  getAvailableQualityData(): VideoQualityData[];

  setPlaybackQualityRange(min: string, max: string, formatId?: string): void;
}

let player: YTPlayer | null = null;

export async function getPlayer(): Promise<YTPlayer> {
  if (player) return player;

  player = await waitForChildAdd(
    document.body,
    (node): node is YTPlayer =>
      node instanceof HTMLElement &&
      node.classList.contains('html5-video-player'),
    true
  );

  return player;
}
