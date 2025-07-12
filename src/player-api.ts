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

/**
 * document.querySelector but waits for the Element to be added if it doesn't already exist.
 */
export async function requireElement<E extends typeof Element>(
  cssSelectors: string,
  expected: E
): Promise<InstanceType<E>> {
  const alreadyPresent = document.querySelector(cssSelectors);
  if (alreadyPresent) {
    if (!(alreadyPresent instanceof expected)) throw new Error();

    // Cast required due to narrowing limitations.
    // https://github.com/microsoft/TypeScript/issues/55241
    return alreadyPresent as InstanceType<E>;
  }

  const result = await waitForChildAdd(
    document.body,
    (node): node is Element =>
      node instanceof Element && node.matches(cssSelectors),
    true
  );

  if (!(result instanceof expected)) throw new Error();
  return result as InstanceType<E>;
}

let player: YTPlayer | null = null;

export async function getPlayer(): Promise<YTPlayer> {
  if (player) return player;

  player = (await requireElement(
    '.html5-video-player',
    HTMLElement
  )) as YTPlayer;

  return player;
}
