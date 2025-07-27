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

export type VideoID = string;

export interface VideoData {
  video_id: VideoID | undefined;
}

export type PlayerStateKeys =
  | 'isBuffering'
  | 'isCued'
  | 'isDomPaused'
  | 'isEnded'
  | 'isError'
  | 'isOrWillBePlaying'
  | 'isPaused'
  | 'isPlaying'
  | 'isSeeking'
  | 'isUiSeeking'
  | 'isUnstarted';

export type PlayerStateObject = Record<PlayerStateKeys, boolean>;

export interface VideoStats {
  el?: 'leanback' | 'shortspage';
}

export interface YTPlayer extends HTMLElement {
  addEventListener<K extends keyof YTPlayerEventMap>(
    type: K,
    listener: (this: YTPlayer, ev: YTPlayerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof YTPlayerEventMap>(
    type: K,
    listener: (this: YTPlayer, ev: YTPlayerEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;

  getPlaybackQualityLabel(): string; // empty if not available

  /**
   * Not available until first `isPlaying` state of playback.
   *
   * Empty if not available.
   */
  getAvailableQualityData(): VideoQualityData[];

  setPlaybackQualityRange(min: string, max: string, formatId?: string): void;

  getVideoData(): VideoData;

  getPlayerStateObject(): PlayerStateObject;

  /**
   * `true` if playing a preview. Otherwise `false`.
   */
  isInline(): boolean;

  getVideoStats(): VideoStats;
}
