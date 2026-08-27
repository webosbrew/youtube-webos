import { configRead, configAddChangeListener } from './config';
import './watch.css';
import { requireElement } from './player_api/helpers';

class Watch {
  #watch;
  #timer;
  #attrChanges;
  #player = null;
  #pinned = false;
  #PLAYER_SELECTOR = 'ytlr-watch-default';

  constructor() {
    this.createElement();
    this.startClock();
    this.playerEvents();
  }

  createElement() {
    this.#watch = document.createElement('div');
    this.#watch.className = 'webOs-watch';
    document.body.appendChild(this.#watch);
  }

  startClock() {
    const nextSeg = (60 - new Date().getSeconds()) * 1000;

    const formatter = new Intl.DateTimeFormat(navigator.language, {
      hour: 'numeric',
      minute: 'numeric'
    });

    const setTime = () => {
      this.#watch.innerText = formatter.format(new Date());
    };

    setTime();
    setTimeout(() => {
      setTime();
      this.#timer = setInterval(setTime, 60000);
    }, nextSeg);
  }

  playerAppear(video) {
    this.changeVisibility();
    this.playerObserver(video);
  }

  changeVisibility() {
    // When pinned the clock stays visible regardless of whether the player is
    // focused.
    if (this.#pinned) {
      this.#watch.style.display = 'block';
      return;
    }

    const focused = this.#player?.getAttribute('hybridnavfocusable') === 'true';
    this.#watch.style.display = focused ? 'none' : 'block';
  }

  setPinned(pinned) {
    this.#pinned = pinned;
    this.changeVisibility();
  }

  async playerEvents() {
    this.#player = await requireElement(this.#PLAYER_SELECTOR, HTMLElement);
    this.playerAppear(this.#player);
  }

  playerObserver(node) {
    this.#attrChanges = new MutationObserver(() => {
      this.changeVisibility();
    });

    this.#attrChanges.observe(node, {
      attributes: true,
      attributeFilter: ['hybridnavfocusable']
    });
  }

  destroy() {
    clearInterval(this.#timer);
    this.#watch?.remove();
    this.#attrChanges?.disconnect();
  }
}

let watchInstance = null;

function refreshWatch() {
  const pinned = configRead('keepWatchPinned');

  // The clock exists while either the config option is on or it's pinned.
  if (configRead('showWatch') || pinned) {
    watchInstance = watchInstance ? watchInstance : new Watch();
    watchInstance.setPinned(pinned);
  } else {
    watchInstance?.destroy();
    watchInstance = null;
  }
}

refreshWatch();

configAddChangeListener('showWatch', () => {
  refreshWatch();
});

configAddChangeListener('keepWatchPinned', () => {
  refreshWatch();
});
