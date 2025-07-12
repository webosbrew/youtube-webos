// src/scroll-seek-controls.js

import { configAddChangeListener, configRead } from './config.js';
import { requireElement } from './player-api.ts';

/**
 * ScrollSeek class to handle scroll seeking functionality in video players.
 * This class listens for wheel events to change the video's seek position
 * based on the scroll direction and updates the UI accordingly.
 */

class ScrollSeek {
  #video = null;
  #container = null;
  #hideTimeout = null;
  #initialized = false;
  #lastScroll = 0;
  #observer = null;
  #videoObserver = null;

  constructor() {
    if (configRead('enableScrollSeek')) this.enable();
    configAddChangeListener('enableScrollSeek', (e) =>
      e.detail?.newValue ? this.enable() : this.disable()
    );
  }

  #getStep = () =>
    Math.min(100, Math.max(3, (this.#video?.duration || 600) * 0.03)); // 1% of duration, capped between 3 and 100 seconds, remove the first arg if uncap MAX limit

  #updateUI = () => {
    if (!this.#video?.duration || !isFinite(this.#video.currentTime)) return;

    const pct = this.#video.currentTime / this.#video.duration;
    const px = (this.#container.offsetWidth || 1000) * pct;
    const q = (sel) => this.#container.querySelector(sel);

    const style = (el, transform) => {
      if (el) {
        el.style.transform = transform;
        el.style.opacity = '1';
      }
    };

    style(q('ytlr-playhead'), `translateX(${px}px)`);
    style(q('.ytLrProgressBarPlayed'), `translateX(0) scaleX(${pct})`);
    style(q('#slider'), '');

    clearTimeout(this.#hideTimeout);
    this.#hideTimeout = setTimeout(() => {
      ['ytlr-playhead', '.ytLrProgressBarPlayed', '#slider']
        .map(q)
        .forEach((el) => {
          if (el) el.style.opacity = '0';
        });
    }, 2000);
  };

  #handleScroll = (e) => {
    const now = Date.now();

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    if (now - this.#lastScroll < 100 || !this.#video?.duration) return;
    this.#lastScroll = now;

    const step = this.#getStep();
    const direction = e.deltaY > 0 ? -step : step;

    this.#video.currentTime = Math.min(
      Math.max(this.#video.currentTime + direction, 0),
      this.#video.duration
    );

    this.#updateUI();
    document.activeElement?.blur?.();
  };

  #watchProgressBarFocus = () => {
    if (!this.#container) return;

    const opts = { passive: false, capture: true };
    const attach = () => {
      window.addEventListener('wheel', this.#handleScroll, opts);
      document.addEventListener('wheel', this.#handleScroll, opts);
    };
    const detach = () => {
      window.removeEventListener('wheel', this.#handleScroll, opts);
      document.removeEventListener('wheel', this.#handleScroll, opts);
    };

    const check = () => {
      const isFocused = this.#container.classList.contains(
        'ytLrProgressBarFocused'
      );
      if (isFocused) {
        attach();
      } else {
        detach();
      }
    };

    check();

    this.#observer = new MutationObserver(check);
    this.#observer.observe(this.#container, {
      attributes: true,
      attributeFilter: ['class']
    });
  };

  #watchVideoChanges = () => {
    const checkVideo = async () => {
      const el = await requireElement('video', HTMLVideoElement);
      if (el === this.#video) return;

      ['timeupdate', 'ended'].forEach((ev) => {
        this.#video?.removeEventListener(ev, this.#updateUI);
      });

      this.#video = el;

      if (!isFinite(this.#video.duration)) {
        await new Promise((res) =>
          this.#video.addEventListener('loadedmetadata', res, { once: true })
        );
      }

      ['timeupdate', 'ended'].forEach((ev) => {
        this.#video.addEventListener(ev, this.#updateUI);
      });
    };

    const debouncedCheck = (() => {
      let timeout = null;
      return () => {
        clearTimeout(timeout);
        timeout = setTimeout(checkVideo, 100);
      };
    })();

    this.#videoObserver = new MutationObserver(debouncedCheck);
    this.#videoObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  };

  async enable() {
    if (this.#initialized) return;
    try {
      [this.#video, this.#container] = await Promise.all([
        requireElement('video', HTMLVideoElement),
        requireElement('ytlr-progress-bar', HTMLElement)
      ]);

      if (!isFinite(this.#video.duration)) {
        await new Promise((res) =>
          this.#video.addEventListener('loadedmetadata', res, { once: true })
        );
      }

      ['timeupdate', 'ended'].forEach((ev) => {
        this.#video.addEventListener(ev, this.#updateUI);
      });

      this.#watchProgressBarFocus();
      this.#watchVideoChanges();

      this.#initialized = true;
    } catch (err) {
      console.warn('[ScrollSeek] Initialization error:', err);
    }
  }

  disable() {
    if (!this.#initialized) return;

    const opts = { passive: false, capture: true };
    window.removeEventListener('wheel', this.#handleScroll, opts);
    document.removeEventListener('wheel', this.#handleScroll, opts);

    this.#observer?.disconnect();
    this.#videoObserver?.disconnect();
    this.#observer = this.#videoObserver = null;

    ['timeupdate', 'ended'].forEach((ev) => {
      this.#video?.removeEventListener(ev, this.#updateUI);
    });

    clearTimeout(this.#hideTimeout);
    this.#video = this.#container = null;
    this.#initialized = false;
  }
}

let scrollSeekInstance = null;

export function toggleScrollSeek(enable) {
  if (enable) {
    scrollSeekInstance ??= new ScrollSeek();
  } else {
    scrollSeekInstance?.disable();
    scrollSeekInstance = null;
  }
}

toggleScrollSeek(configRead('enableScrollSeek'));
