/* eslint no-redeclare: 0 */
/* global fetch:writable */

import { configRead } from './config';

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 *
 * 1. Block all scroll events on the video element
 * 2. Allow scroll events on the progress bar
 * 3. Implement custom scroll behavior for the progress bar
 *
 */

if (configRead('enableScrollSeek')) {
  setupScrollSeek();
}

function setupScrollSeek() {
  const container = document.querySelector('ytlr-progress-bar');
  const playhead = container?.querySelector('ytlr-playhead');
  const playedBar = container?.querySelector('.ytLrProgressBarPlayed');
  const slider = container?.querySelector('#slider');
  let video = document.querySelector('video');
  let hideTimeout = null;

  if (!container || !video) {
    console.warn('Missing video or progress bar');
    return;
  }

  function getDynamicScrollStep() {
    const duration = video?.duration || 600;
    const percent = 0.01; // 1% step
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
      // Let native scroll work when only carousel is active
      return;
    }

    // Otherwise, intercept and seek
    event.preventDefault();

    const step = getDynamicScrollStep();
    const delta = event.deltaY > 0 ? step : -step;

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

  console.log('[✅] Scroll-seek active (with smart UI detection)');
}
