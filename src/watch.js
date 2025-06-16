import { configRead, configAddChangeListener } from './config';
import './watch.css';

class Watch {
  #watch;
  #timer;
  #domObserver;
  #attrChanges;
  #PLAYER_SELECTOR = 'ytlr-watch-default';

  constructor() {
    this.createElement();
    this.startClock();
  }

  createElement() {
    this.#watch = document.createElement('div');
    this.#watch.className = 'webOs-watch';
    document.body.appendChild(this.#watch);
  }

  startClock() {
    const nextSeg = (60 - new Date().getSeconds()) * 1000;

    const setTime = () => {
      this.#watch.innerText = new Intl.DateTimeFormat(navigator.language, {
        hour: 'numeric',
        minute: 'numeric'
      }).format(new Date());
    };

    setTime();
    setTimeout(() => {
      setTime();
      this.#timer = setInterval(setTime, 60000);
    }, nextSeg);

    const video = document.querySelector(this.#PLAYER_SELECTOR);

    if (video === null) {
      this.waitingVideo();
    } else {
      this.playerAppear(video);
    }
  }

  playerAppear(video) {
    this.#watch.style.display =
      video.getAttribute('hybridnavfocusable') === 'true' ? 'none' : 'block';
    this.playerObserver(video);
  }

  waitingVideo() {
    this.#domObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            node.matches(this.#PLAYER_SELECTOR)
          ) {
            this.#domObserver.disconnect();
            this.playerAppear(node);
          }
        }
      }
    });

    this.#domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  playerObserver(node) {
    this.#attrChanges = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const value = mutation.target.getAttribute('hybridnavfocusable');
        // Hide watch when player is focused
        this.#watch.style.display = value === 'true' ? 'none' : 'block';
      }
    });

    this.#attrChanges.observe(node, {
      attributes: true,
      attributeFilter: ['hybridnavfocusable']
    });
  }

  destroy() {
    clearInterval(this.#timer);
    this.#watch?.remove();
    this.#domObserver?.disconnect();
    this.#attrChanges?.disconnect();
  }
}

let watchInstance = null;

function toggleWatch(show) {
  if (show) {
    watchInstance = watchInstance ? watchInstance : new Watch();
  } else {
    watchInstance?.destroy();
    watchInstance = null;
  }
}

toggleWatch(configRead('showWatch'));

configAddChangeListener('showWatch', (evt) => {
  toggleWatch(evt.detail.newValue);
});
