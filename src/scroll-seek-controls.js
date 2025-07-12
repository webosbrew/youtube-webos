import { configAddChangeListener, configRead } from './config.js';
import { requireElement } from './screensaver-fix.ts';

class ScrollSeek {
  #video = null;
  #onScroll = null;
  #updateProgressUI = null;
  #hideTimeout = null;
  #initialized = false;

  constructor() {
    if (configRead('enableScrollSeek')) this.enable();
    configAddChangeListener('enableScrollSeek', (evt) => {
      evt.detail?.newValue ? this.enable() : this.disable();
    });
  }

  #log(...args) {
    const DEBUG = false;
    if (DEBUG) console.log('[ScrollSeek]', ...args);
  }

  #getDynamicScrollStep() {
    const duration = this.#video?.duration || 600;
    return Math.min(15, Math.max(3, duration * 0.01));
  }

  #isCarouselVisible() {
    return [...document.querySelectorAll('.ytVirtualListContainer')].some(
      (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      }
    );
  }

  #isProgressVisible(playhead) {
    if (!playhead) return false;
    const style = window.getComputedStyle(playhead);
    return style.opacity !== '0' && style.display !== 'none';
  }

  async enable() {
    if (this.#initialized) return;

    try {
      this.#video = await requireElement('video', HTMLVideoElement);
      const container = await requireElement('ytlr-progress-bar', HTMLElement);

      const playhead = container.querySelector('ytlr-playhead');
      const playedBar = container.querySelector('.ytLrProgressBarPlayed');
      const slider = container.querySelector('#slider');

      this.#updateProgressUI = () => {
        if (
          !this.#video ||
          !isFinite(this.#video.currentTime) ||
          !isFinite(this.#video.duration)
        ) {
          return;
        }

        const percent = this.#video.currentTime / this.#video.duration;
        const px = (container.offsetWidth || 1000) * percent;

        if (playhead) {
          playhead.style.transform = `translateX(${px}px)`;
          playhead.style.opacity = '1';
        }
        if (playedBar) {
          playedBar.style.transform = `translateX(0) scaleX(${percent})`;
          playedBar.style.opacity = '1';
        }
        if (slider) {
          slider.style.opacity = '1';
        }

        clearTimeout(this.#hideTimeout);
        this.#hideTimeout = setTimeout(() => {
          if (playhead) playhead.style.opacity = '0';
          if (playedBar) playedBar.style.opacity = '0';
          if (slider) slider.style.opacity = '0';
        }, 2000);
      };

      this.#onScroll = (event) => {
        if (!this.#video || !isFinite(this.#video.duration)) return;

        const carouselVisible = this.#isCarouselVisible();
        const progressVisible = this.#isProgressVisible(playhead);

        if (carouselVisible && !progressVisible) return;

        event.preventDefault();

        const delta =
          event.deltaY > 0
            ? -this.#getDynamicScrollStep()
            : this.#getDynamicScrollStep();
        this.#video.currentTime = Math.min(
          Math.max(this.#video.currentTime + delta, 0),
          this.#video.duration
        );

        this.#updateProgressUI();
      };

      this.#video.addEventListener('timeupdate', this.#updateProgressUI);
      this.#video.addEventListener('ended', this.#updateProgressUI);
      document.addEventListener('wheel', this.#onScroll, { passive: false });

      this.#initialized = true;
      this.#log('ScrollSeek enabled');
    } catch (err) {
      this.#log('ScrollSeek failed to initialize:', err);
    }
  }

  disable() {
    if (!this.#initialized) return;

    document.removeEventListener('wheel', this.#onScroll, { passive: false });

    if (this.#video) {
      this.#video.removeEventListener('timeupdate', this.#updateProgressUI);
      this.#video.removeEventListener('ended', this.#updateProgressUI);
    }

    clearTimeout(this.#hideTimeout);

    this.#video = null;
    this.#onScroll = null;
    this.#updateProgressUI = null;
    this.#hideTimeout = null;
    this.#initialized = false;

    this.#log('ScrollSeek disabled');
  }
}

let scrollSeekInstance = null;

function toggleScrollSeek(enable) {
  if (enable) {
    if (!scrollSeekInstance) scrollSeekInstance = new ScrollSeek();
  } else {
    scrollSeekInstance?.disable();
    scrollSeekInstance = null;
  }
}

toggleScrollSeek(configRead('enableScrollSeek'));
