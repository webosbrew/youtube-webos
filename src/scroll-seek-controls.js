import { configAddChangeListener, configRead } from './config.js';

// console.log('[ScrollSeek] Module loaded');

(function initScrollSeekModule() {
  let isInitialized = false;
  let observer = null;
  let video = null;
  let onScroll = null;
  let updateProgressUI = null;
  let hideTimeout = null;

  const DEBUG = false; // Set to true for verbose logs

  function log(...args) {
    if (DEBUG) console.log('[ScrollSeek]', ...args);
  }

  function getDynamicScrollStep() {
    const duration = video?.duration || 600;
    const percent = 0.01;
    return Math.min(15, Math.max(3, duration * percent));
  }

  function isCarouselVisible() {
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

  function enableScrollSeek() {
    if (isInitialized) return;

    const container = document.querySelector('ytlr-progress-bar');
    const playhead = container?.querySelector('ytlr-playhead');
    const playedBar = container?.querySelector('.ytLrProgressBarPlayed');
    const slider = container?.querySelector('#slider');
    video = document.querySelector('video');

    if (!container || !video) {
      log('Missing elements, setting up observer...');
      if (!observer) {
        observer = new MutationObserver(() => {
          if (!isInitialized && document.querySelector('video')) {
            enableScrollSeek();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
      return;
    }

    function isProgressVisible() {
      const style = playhead && window.getComputedStyle(playhead);
      return playhead && style?.opacity !== '0' && style?.display !== 'none';
    }

    updateProgressUI = function () {
      if (!video || !isFinite(video.currentTime) || !isFinite(video.duration))
        return;

      const percent = video.currentTime / video.duration;
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

      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        if (playhead) playhead.style.opacity = '0';
        if (playedBar) playedBar.style.opacity = '0';
        if (slider) slider.style.opacity = '0';
      }, 2000);
    };

    onScroll = function (event) {
      if (!video || !isFinite(video.duration)) return;

      const carouselVisible = isCarouselVisible();
      const progressVisible = isProgressVisible();

      if (carouselVisible && !progressVisible) {
        return;
      }

      event.preventDefault();

      const step = getDynamicScrollStep();
      const delta = event.deltaY > 0 ? -step : step;
      video.currentTime = Math.min(
        Math.max(video.currentTime + delta, 0),
        video.duration
      );

      updateProgressUI();
    };

    video.addEventListener('timeupdate', updateProgressUI);
    video.addEventListener('ended', updateProgressUI);
    document.addEventListener('wheel', onScroll, { passive: false });

    isInitialized = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    log('Scroll-seek enabled');
  }

  function disableScrollSeek() {
    if (!isInitialized) return;

    document.removeEventListener('wheel', onScroll, { passive: false });
    if (video) {
      video.removeEventListener('timeupdate', updateProgressUI);
      video.removeEventListener('ended', updateProgressUI);
    }

    clearTimeout(hideTimeout);

    isInitialized = false;
    video = null;
    onScroll = null;
    updateProgressUI = null;
    hideTimeout = null;

    log('Scroll-seek disabled');
  }

  if (configRead('enableScrollSeek')) {
    enableScrollSeek();
  } else {
    log('Scroll-seek is disabled at startup');
  }

  configAddChangeListener('enableScrollSeek', (evt) => {
    const value = evt.detail?.newValue;
    if (value) {
      enableScrollSeek();
    } else {
      disableScrollSeek();
    }
  });
})();
