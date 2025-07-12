import { configAddChangeListener, configRead } from './config.js';

class ScrollSeek {
  #observer = null;
  #video = null;
  #onScroll = null;
  #updateProgressUI = null;
  #hideTimeout = null;
  #initialized = false;

  constructor() {
    if (configRead('enableScrollSeek')) {
      this.enable();
    }

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
    const percent = 0.01;
    return Math.min(15, Math.max(3, duration * percent));
  }

  #isCarouselVisible() {
    const visibleContainers = [
      ...document.querySelectorAll('.ytVirtualListContainer')
    ].filter((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden'
      );
    });
    return visibleContainers.length > 0;
  }

  #isProgressVisible(playhead) {
    const style = playhead && window.getComputedStyle(playhead);
    return playhead && style?.opacity !== '0' && style?.display !== 'none';
  }

  enable() {
    if (this.#initialized) return;

    const container = document.querySelector('ytlr-progress-bar');
    const playhead = container?.querySelector('ytlr-playhead');
    const playedBar = container?.querySelector('.ytLrProgressBarPlayed');
    const slider = container?.querySelector('#slider');
    this.#video = document.querySelector('video');

    if (!container || !this.#video) {
      this.#log('Missing elements, setting up observer...');
      if (!this.#observer) {
        this.#observer = new MutationObserver(() => {
          if (!this.#initialized && document.querySelector('video')) {
            this.enable();
          }
        });
        this.#observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
      return;
    }

    this.#updateProgressUI = () => {
      if (
        !this.#video ||
        !isFinite(this.#video.currentTime) ||
        !isFinite(this.#video.duration)
      )
        return;

      const percent = this.#video.currentTime / this.#video.duration;
      const barWidth = container.offsetWidth || 1000;
      const px = barWidth * percent;

      if (playhead) {
        playhead.style.transform = `translateX(${px}px)`;
        playhead.style.opacity = '1';
      }
      if (playedBar) {
        playedBar.style.transform = `translateX(0rem) scaleX(${percent})`;
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

      const step = this.#getDynamicScrollStep();
      const delta = event.deltaY > 0 ? -step : step;

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

    if (this.#observer) {
      this.#observer.disconnect();
      this.#observer = null;
    }

    this.#log('Scroll-seek enabled');
  }

  disable() {
    if (!this.#initialized) return;

    document.removeEventListener('wheel', this.#onScroll, { passive: false });

    if (this.#video) {
      this.#video.removeEventListener('timeupdate', this.#updateProgressUI);
      this.#video.removeEventListener('ended', this.#updateProgressUI);
    }

    clearTimeout(this.#hideTimeout);

    this.#initialized = false;
    this.#video = null;
    this.#onScroll = null;
    this.#updateProgressUI = null;
    this.#hideTimeout = null;

    this.#log('Scroll-seek disabled');
  }
}

// Singleton-like instance management
let scrollSeekInstance = null;

function toggleScrollSeek(enable) {
  if (enable) {
    scrollSeekInstance = scrollSeekInstance ?? new ScrollSeek();
  } else {
    scrollSeekInstance?.disable();
    scrollSeekInstance = null;
  }
}

// Initial setup
toggleScrollSeek(configRead('enableScrollSeek'));
