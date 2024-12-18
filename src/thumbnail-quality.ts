const webpTestImgs = {
  lossy: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  lossless: 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  alpha:
    'UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggGAAAABQBAJ0BKgEAAQAAAP4AAA3AAP7mtQAAAA==',
  animation:
    'UklGRlIAAABXRUJQVlA4WAoAAAASAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GJgAAAAAAAAAAAAAAAAAAAGQAAABWUDhMDQAAAC8AAAAQBxAREYiI/gcA'
} as const;

function checkWebpFeature(
  feature: keyof typeof webpTestImgs,
  callback: (
    featureName: keyof typeof webpTestImgs,
    isSupported: boolean
  ) => void
) {
  const img = new Image();
  img.onload = function () {
    const result = img.width > 0 && img.height > 0;
    callback(feature, result);
  };

  img.onerror = function () {
    callback(feature, false);
  };

  img.src = 'data:image/webp;base64,' + webpTestImgs[feature];
}

let webpSupported = false;
checkWebpFeature('lossy', (_, support) => {
  webpSupported = support;
});

function rewriteURL(url: URL) {
  const YT_THUMBNAIL_PATHNAME_REGEX =
    /vi(?:_webp)?(\/.*?\/)([a-z0-9]+?)(_\w*?)?\.[a-z]+$/g;

  const YT_TARGET_THUMBNAIL_NAMES = [
    'sddefault',
    'hqdefault',
    'mqdefault',
    'default'
  ] as const;

  const isABTest = url.hostname.match(/^i\d/) !== null;
  // Don't know how to handle A/B test thumbnails so we don't upgrade them.
  if (isABTest) return null;

  const replacementPathname = url.pathname.replace(
    YT_THUMBNAIL_PATHNAME_REGEX,
    (match, p1, p2, p3) => {
      if (!YT_TARGET_THUMBNAIL_NAMES.includes(p2)) return match; // Only rewrite regular thumbnail URLs. Not shorts, etc.
      return `${webpSupported ? 'vi_webp' : 'vi'}${p1}sddefault${p3 ?? ''}.${webpSupported ? 'webp' : 'jpg'}`;
    }
  );
  if (url.pathname === replacementPathname)
    // pathname not changed because not a regular thumbnail or already upgraded.
    return null;

  url = new URL(url);

  url.pathname = replacementPathname;
  url.search = '';

  return url;
}

function parseCSSUrl(value: string) {
  return new URL(value.slice(4, -1).replace(/["']/g, ''));
}

async function upgradeBgImg(element: HTMLElement) {
  const style = element.style;
  const old = parseCSSUrl(style.backgroundImage);

  const target = rewriteURL(old);
  if (!target) return;

  const lazyLoader = new Image();

  lazyLoader.onload = () => {
    // Don't swap if a placeholder thumbnail was provided.
    // Placeholder thumbnails are the same size as the "default" size.
    if (lazyLoader.naturalHeight === 90) return;

    const curr = parseCSSUrl(style.backgroundImage);

    // Don't swap out element image if it has been changed while target image was loading.
    if (curr.href !== old.href) return;

    style.backgroundImage = `url(${target.href})`;
  };

  lazyLoader.src = target.href;
}

const obs = new MutationObserver((mutations) => {
  const YT_THUMBNAIL_ELEMENT_TAG = 'ytlr-thumbnail-details';

  const dummy = document.createElement('div');

  // handle backgroundImage change
  // YT re-uses thumbnail elements in its virtual list implementation.
  mutations
    .filter((mut) => mut.type === 'attributes')
    .map((mut) => [mut.target, mut] as const)
    .filter((value): value is [HTMLElement, MutationRecord] => {
      const [node, { oldValue }] = value;
      dummy.style.cssText = oldValue ?? '';

      return (
        node instanceof HTMLElement &&
        node.matches(YT_THUMBNAIL_ELEMENT_TAG) &&
        node.style.backgroundImage !== '' &&
        node.style.backgroundImage !== dummy.style.backgroundImage
      );
    })
    .map(([elem]) => elem)
    .forEach(upgradeBgImg);

  // handle element add
  mutations
    .filter((mut) => mut.type === 'childList')
    .flatMap((mut) => Array.from(mut.addedNodes))
    .filter((node) => node instanceof HTMLElement)
    .flatMap((elem) =>
      Array.from(elem.querySelectorAll<HTMLElement>(YT_THUMBNAIL_ELEMENT_TAG))
    )
    .filter((elem) => elem.style.backgroundImage !== '')
    .forEach(upgradeBgImg);
});

function enableObserver() {
  obs.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style'],
    attributeOldValue: true
  });
}

import { configRead, configAddChangeListener } from './config';

if (configRead('upgradeThumbnails')) enableObserver();

configAddChangeListener('upgradeThumbnails', (value) =>
  value ? enableObserver() : obs.disconnect()
);
