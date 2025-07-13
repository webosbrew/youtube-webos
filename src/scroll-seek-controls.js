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
  #initialized = false;
  #observer = null;
  #elPlayheadStyle = null;
  #elProgressBarStyle = null;
  #scrollAttached = false;
  #wasFocused = null;
  #containerWidth = 1000;
  #opts = { passive: false, capture: true };

  #getStep = () =>
    Math.min(100, Math.max(3, (this.#video?.duration || 600) * 0.03)); // 3% of video duration, capped between 3–100 seconds

  #updateUI = () => {
    if (!this.#video?.duration || !isFinite(this.#video.currentTime)) return;

    const pct = this.#video.currentTime / this.#video.duration;
    const px = this.#containerWidth * pct;

    this.#elPlayheadStyle.transform = `translateX(${px}px)`;
    this.#elProgressBarStyle.transform = `translateX(0) scaleX(${pct})`;
  };

  #handleScroll = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    if (!this.#video?.duration) return;

    const step = this.#getStep();
    const direction = e.deltaY > 0 ? -step : step;

    this.#video.currentTime = Math.min(
      Math.max(this.#video.currentTime + direction, 0),
      this.#video.duration
    );

    this.#updateUI();
  };

  #watchProgressBarFocus = () => {
    if (!this.#container) return;

    const attach = () => {
      if (!this.#scrollAttached) {
        window.addEventListener('wheel', this.#handleScroll, this.#opts);
        this.#scrollAttached = true;
      }
    };

    const detach = () => {
      if (this.#scrollAttached) {
        window.removeEventListener('wheel', this.#handleScroll, this.#opts);
        this.#scrollAttached = false;
      }
    };

    const check = () => {
      const isFocused = this.#container.classList.contains(
        'ytLrProgressBarFocused'
      );
      if (isFocused !== this.#wasFocused) {
        this.#wasFocused = isFocused;
        isFocused ? attach() : detach();
      }
    };

    check();

    this.#observer?.disconnect();
    this.#observer = new MutationObserver(check);
    this.#observer.observe(this.#container, {
      attributes: true,
      attributeFilter: ['class']
    });
  };

  async enable() {
    if (this.#initialized) return;
    try {
      [this.#video, this.#container] = await Promise.all([
        requireElement('video', HTMLVideoElement),
        requireElement('ytlr-progress-bar', HTMLElement)
      ]);

      this.#elPlayheadStyle =
        this.#container.querySelector('ytlr-playhead')?.style;
      this.#elProgressBarStyle = this.#container.querySelector(
        '.ytLrProgressBarPlayed'
      )?.style;

      [this.#elPlayheadStyle, this.#elProgressBarStyle].forEach((elstyle) => {
        if (elstyle) elstyle.willChange = 'transform';
      });

      if (!isFinite(this.#video.duration)) {
        await new Promise((res) =>
          this.#video.addEventListener('loadedmetadata', res, { once: true })
        );
      }

      ['timeupdate', 'ended'].forEach((ev) => {
        this.#video.addEventListener(ev, this.#updateUI);
      });

      this.#containerWidth = this.#container.offsetWidth || 1000;
      this.#watchProgressBarFocus();

      this.#initialized = true;
    } catch (err) {
      console.warn('[ScrollSeek] Initialization error:', err);
    }
  }

  disable() {
    if (!this.#initialized) return;

    if (this.#scrollAttached) {
      window.removeEventListener('wheel', this.#handleScroll, this.#opts);
      this.#scrollAttached = false;
    }

    this.#observer?.disconnect();
    this.#observer = null;

    ['timeupdate', 'ended'].forEach((ev) => {
      this.#video?.removeEventListener(ev, this.#updateUI);
    });

    this.#video = null;
    this.#container = null;
    this.#elPlayheadStyle = null;
    this.#elProgressBarStyle = null;
    this.#wasFocused = null;

    this.#initialized = false;
  }
}

let scrollSeekInstance = null;

export function toggleScrollSeek(enable) {
  if (enable) {
    if (!scrollSeekInstance) {
      scrollSeekInstance = new ScrollSeek();
    }
    scrollSeekInstance.enable();
  } else {
    scrollSeekInstance?.disable();
    scrollSeekInstance = null;
  }
}

toggleScrollSeek(configRead('enableScrollSeek'));

configAddChangeListener('enableScrollSeek', (e) =>
  toggleScrollSeek(e.detail?.newValue)
);
