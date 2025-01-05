/**
 * On webOS, when a video element doesn't perfectly fill
 * the entire screen, the screensaver can be kick in.
 */

import { waitForChildAdd } from './utils';

/**
 * document.querySelector but waits for the Element to be added if it doesn't already exist.
 */
async function requireElement<E extends typeof Element>(
  cssSelectors: string,
  expected: E
): Promise<InstanceType<E>> {
  const alreadyPresent = document.querySelector(cssSelectors);
  if (alreadyPresent) {
    if (!(alreadyPresent instanceof expected)) throw new Error();

    // Cast required due to narrowing limitations.
    // https://github.com/microsoft/TypeScript/issues/55241
    return alreadyPresent as InstanceType<E>;
  }

  const result = await waitForChildAdd(
    document.body,
    (node): node is Element =>
      node instanceof Element && node.matches(cssSelectors),
    true
  );

  if (!(result instanceof expected)) throw new Error();
  return result as InstanceType<E>;
}

function isPlayerHidden(video: HTMLVideoElement) {
  // Youtube uses display none sometimes along with a negative top to hide the HTMLVideoElement.
  return video.style.display == 'none' || video.style.top.startsWith('-');
}

function isWatchPage() {
  return document.body.classList.contains('WEB_PAGE_TYPE_WATCH');
}

const playerCtrlObs = new MutationObserver((mutations, obs) => {
  // Only watch page has a full-screen player.
  if (!isWatchPage()) {
    obs.disconnect();
    return;
  }

  const video = mutations[0]?.target;
  if (!(video instanceof HTMLVideoElement)) throw new Error();
  const style = video.style;

  // Not sure if there will be a race condition so just in case.
  if (isPlayerHidden(video)) return;

  const targetWidth = `${window.innerWidth}px`;
  const targetHeight = `${window.innerHeight}px`;
  const targetLeft = '0px';
  const targetTop = '0px';

  /**
   * Check to see if identical before assignment as some webOS versions will trigger a mutation
   * event even if the assignment effectively does nothing, leading to an infinite loop.
   */
  style.width !== targetWidth && (style.width = targetWidth);
  style.height !== targetHeight && (style.height = targetHeight);
  style.left !== targetLeft && (style.left = targetLeft);
  style.top !== targetTop && (style.top = targetTop);
});

const bodyAttrObs = new MutationObserver(async () => {
  if (!isWatchPage()) return;

  // Youtube TV re-uses the same video element for everything.
  const video = await requireElement('video', HTMLVideoElement);
  playerCtrlObs.observe(video, {
    attributes: true,
    attributeFilter: ['style']
  });
});

bodyAttrObs.observe(document.body, {
  attributes: true,
  attributeFilter: ['class']
});
