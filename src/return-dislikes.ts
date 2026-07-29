import { configAddChangeListener, configRead } from './config.js';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager, VideoID } from './player_api';
import './return-dislikes.css';
import { showNotification } from './ui.js';

interface RYDData {
  id: string;
  likes: number;
  dislikes: number;
  rating: number;
  viewCount: number;
  deleted: boolean;
}

const RYD_API = 'https://returnyoutubedislikeapi.com/votes?videoId=';
const cache = new Map<string, RYDData>();

let badgeElement: HTMLElement | null = null;
let currentVideoID: VideoID | null = null;
let currentDislikeText: string | null = null;
let observer: MutationObserver | null = null;

function isEnabled(): boolean {
  return configRead('enableReturnYouTubeDislike');
}

function formatCount(num: number): string {
  if (typeof num !== 'number' || isNaN(num)) return '0';
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toLocaleString();
}

function calculateRatio(likes: number, dislikes: number): string {
  const total = likes + dislikes;
  if (total === 0) return '100%';
  const percentage = Math.round((likes / total) * 100);
  return `${percentage}%`;
}

function getOrCreateBadge(): HTMLElement {
  if (!badgeElement) {
    badgeElement = document.createElement('div');
    badgeElement.className = 'ytaf-ryd-badge ytaf-ryd-badge-hidden';
    document.body.appendChild(badgeElement);
  }
  return badgeElement;
}

function updateBadge(data: RYDData | null) {
  const badge = getOrCreateBadge();

  if (!data || !isEnabled()) {
    badge.classList.add('ytaf-ryd-badge-hidden');
    return;
  }

  const dislikeText = formatCount(data.dislikes);
  const ratioText = calculateRatio(data.likes, data.dislikes);

  badge.innerHTML = `<span class="ytaf-ryd-dislike-icon">👎</span> <span>${dislikeText}</span> <span class="ytaf-ryd-ratio">(${ratioText})</span>`;
  badge.classList.remove('ytaf-ryd-badge-hidden');
}

function injectDislikeToPlayerControls(dislikeText: string | null) {
  if (!isEnabled() || !dislikeText) {
    const customLabels = document.querySelectorAll(
      '.ytaf-ryd-sublabel, .ytaf-ryd-count-text, .ytaf-ryd-native-label'
    );
    customLabels.forEach((el) => el.remove());
    return;
  }

  const dislikeBtn = document.querySelector(
    '[idomkey="dislike-button"]'
  ) as HTMLElement | null;

  if (!dislikeBtn) return;

  // Remove any legacy custom elements from prior builds
  const oldSublabel = dislikeBtn.querySelector('.ytaf-ryd-sublabel');
  if (oldSublabel) oldSublabel.remove();
  const oldInlineText = dislikeBtn.querySelector('.ytaf-ryd-count-text');
  if (oldInlineText) oldInlineText.remove();

  const container =
    dislikeBtn.querySelector('yt-button-container') || dislikeBtn;

  // Look for YouTube's native text element inside dislike button or create one with native classes
  let formattedString = dislikeBtn.querySelector(
    'yt-formatted-string'
  ) as HTMLElement | null;

  if (formattedString) {
    if (formattedString.textContent !== dislikeText) {
      formattedString.textContent = dislikeText;
    }
  } else {
    formattedString = document.createElement('yt-formatted-string');
    formattedString.className = 'XGffTd OqGroe ytaf-ryd-native-label';
    formattedString.setAttribute('dir', 'auto');
    formattedString.setAttribute('tabindex', '-1');
    formattedString.textContent = dislikeText;
    container.appendChild(formattedString);
  }
}

function setupMutationObserver() {
  if (observer) return;

  observer = new MutationObserver(() => {
    if (currentDislikeText && isEnabled()) {
      injectDislikeToPlayerControls(currentDislikeText);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

async function fetchDislikes(videoID: string): Promise<RYDData | null> {
  if (cache.has(videoID)) {
    return cache.get(videoID) || null;
  }

  try {
    const response = await fetch(`${RYD_API}${encodeURIComponent(videoID)}`);
    if (!response.ok) {
      console.warn('[return-dislikes] API response not ok:', response.status);
      return null;
    }

    const data: RYDData = await response.json();
    cache.set(videoID, data);
    return data;
  } catch (err) {
    console.error('[return-dislikes] Failed to fetch dislikes:', err);
    return null;
  }
}

async function processVideo(videoID: VideoID) {
  if (!isEnabled() || !videoID) {
    currentDislikeText = null;
    updateBadge(null);
    injectDislikeToPlayerControls(null);
    return;
  }

  currentVideoID = videoID;
  const data = await fetchDislikes(videoID);

  if (currentVideoID !== videoID) return; // Video changed while fetching

  if (data) {
    const dislikeText = formatCount(data.dislikes);
    const ratioText = calculateRatio(data.likes, data.dislikes);

    currentDislikeText = dislikeText;
    updateBadge(data);
    injectDislikeToPlayerControls(dislikeText);
    showNotification(`👎 ${dislikeText} dislikes (${ratioText} rating)`, 3500);
  } else {
    currentDislikeText = null;
    updateBadge(null);
    injectDislikeToPlayerControls(null);
  }
}

function getVideoIDFromHash(): string | null {
  try {
    const hash = window.location.hash.substring(1);
    if (!hash) return null;
    const url = new URL(hash, window.location.href);
    if (url.pathname === '/watch') {
      return url.searchParams.get('v');
    }
  } catch (e) {
    // Ignore invalid hash formats
  }
  return null;
}

// Initialize Return YouTube Dislike event listeners
async function init() {
  setupMutationObserver();

  const manager = await getPlayerManager();

  type EventMap = EventMapOf<PlayerManager>;

  manager.addEventListener('newVideo', (evt: EventMap['newVideo']) => {
    const videoID = evt.detail;
    if (manager.playerMode === PlayerMode.PREVIEW) return;
    if (videoID) {
      processVideo(videoID);
    }
  });

  window.addEventListener('hashchange', () => {
    const videoID = getVideoIDFromHash();
    if (videoID && videoID !== currentVideoID) {
      processVideo(videoID);
    } else if (!videoID) {
      currentDislikeText = null;
      updateBadge(null);
      injectDislikeToPlayerControls(null);
    }
  });

  configAddChangeListener('enableReturnYouTubeDislike', (evt) => {
    const enabled = (evt as CustomEvent).detail.newValue;
    if (!enabled) {
      currentDislikeText = null;
      updateBadge(null);
      injectDislikeToPlayerControls(null);
    } else if (currentVideoID) {
      processVideo(currentVideoID);
    }
  });

  // Initial check
  const initialID = manager.currentVideoID || getVideoIDFromHash();
  if (initialID) {
    processVideo(initialID);
  }
}

init();
