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
  #lastScroll = 0;
  #observer = null;
  #elPlayhead = null;
  #elProgressBar = null;
  #elSlider = null;
  #scrollAttached = false;

  constructor() {
    if (configRead('enableScrollSeek')) this.enable();
    configAddChangeListener('enableScrollSeek', (e) =>
      e.detail?.newValue ? this.enable() : this.disable()
    );
  }

  #getStep = () =>
    Math.min(100, Math.max(3, (this.#video?.duration || 600) * 0.03)); // 3% of video duration, capped at 3 - 100 seconds

  #updateUI = () => {
    if (!this.#video?.duration || !isFinite(this.#video.currentTime)) return;

    const pct = this.#video.currentTime / this.#video.duration;
    const px = (this.#container.offsetWidth || 1000) * pct;

    const style = (el, transform) => {
      if (el) {
        el.style.transform = transform;
        el.style.opacity = '1';
      }
    };

    style(this.#elPlayhead, `translateX(${px}px)`);
    style(this.#elProgressBar, `translateX(0) scaleX(${pct})`);
    style(this.#elSlider, '');
  };

  #handleScroll = (e) => {
    const now = Date.now();

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    if (now - this.#lastScroll < 250 || !this.#video?.duration) return; // debounce 250ms
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
      if (this.#scrollAttached) return;
      window.addEventListener('wheel', this.#handleScroll, opts);
      this.#scrollAttached = true;
    };
    const detach = () => {
      if (!this.#scrollAttached) return;
      window.removeEventListener('wheel', this.#handleScroll, opts);
      this.#scrollAttached = false;
    };

    const check = () => {
      const isFocused = this.#container.classList.contains(
        'ytLrProgressBarFocused'
      );
      isFocused ? attach() : detach();
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

      this.#elPlayhead = this.#container.querySelector('ytlr-playhead');
      this.#elProgressBar = this.#container.querySelector(
        '.ytLrProgressBarPlayed'
      );
      this.#elSlider = this.#container.querySelector('#slider');

      if (!isFinite(this.#video.duration)) {
        await new Promise((res) =>
          this.#video.addEventListener('loadedmetadata', res, { once: true })
        );
      }

      ['timeupdate', 'ended'].forEach((ev) => {
        this.#video.addEventListener(ev, this.#updateUI);
      });

      this.#watchProgressBarFocus();

      this.#initialized = true;
    } catch (err) {
      console.warn('[ScrollSeek] Initialization error:', err);
    }
  }

  disable() {
    if (!this.#initialized) return;

    const opts = { passive: false, capture: true };
    window.removeEventListener('wheel', this.#handleScroll, opts);

    this.#observer?.disconnect();

    ['timeupdate', 'ended'].forEach((ev) => {
      this.#video?.removeEventListener(ev, this.#updateUI);
    });

    this.#video = this.#container = null;
    this.#elPlayhead = this.#elProgressBar = this.#elSlider = null;
    this.#scrollAttached = false;
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
