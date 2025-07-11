// src/scroll-seek-controls.js
console.log('Module loaded');
(function autoInitScrollSeek() {
  let isScrollSeekInitialized = false;

  function setupScrollSeek() {
    const container = document.querySelector('ytlr-progress-bar');
    const playhead = container?.querySelector('ytlr-playhead');
    const playedBar = container?.querySelector('.ytLrProgressBarPlayed');
    const slider = container?.querySelector('#slider');
    let video = document.querySelector('video');
    let hideTimeout = null;

    if (!container || !video) {
      console.warn('[ScrollSeek] Missing video or progress bar');
      return false;
    }

    if (isScrollSeekInitialized) {
      return true;
    }

    function getDynamicScrollStep() {
      const duration = video?.duration || 600;
      const percent = 0.01;
      const step = duration * percent;
      return Math.min(15, Math.max(3, step));
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

    function isProgressVisible() {
      const style = playhead && window.getComputedStyle(playhead);
      return playhead && style?.opacity !== '0' && style?.display !== 'none';
    }

    function updateProgressUI() {
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
    }

    function onScroll(event) {
      if (!video || !isFinite(video.duration)) return;

      const carouselVisible = isCarouselVisible();
      const progressVisible = isProgressVisible();

      if (carouselVisible && !progressVisible) {
        return;
      }

      event.preventDefault();

      const step = getDynamicScrollStep();
      const delta = event.deltaY > 0 ? -step : step;

      const newTime = Math.min(
        Math.max(video.currentTime + delta, 0),
        video.duration
      );
      video.currentTime = newTime;

      updateProgressUI();
    }

    video.addEventListener('timeupdate', updateProgressUI);
    video.addEventListener('ended', updateProgressUI);
    document.addEventListener('wheel', onScroll, { passive: false });

    isScrollSeekInitialized = true;
    console.log('[✅] Scroll-seek initialized');
    return true;
  }

  // Run initially
  if (!setupScrollSeek()) {
    // Setup observer for dynamic video loading
    const observer = new MutationObserver(() => {
      if (!isScrollSeekInitialized && setupScrollSeek()) {
        observer.disconnect(); // Stop observing once setup is successful
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[⏳] Waiting for video to appear...');
  }
})();
