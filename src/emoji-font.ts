import twemoji from '@twemoji/api';

import './emoji-font.css';

const YT_FORMATTED_STR_TAG = 'yt-formatted-string';

const emojiObs = new MutationObserver((mutations) => {
  mutations
    .flatMap((mut) => Array.from(mut.addedNodes))
    .filter((node) => node instanceof HTMLElement)
    .flatMap((elem) =>
      Array.from(
        elem.querySelectorAll(YT_FORMATTED_STR_TAG) as NodeListOf<HTMLElement>
      )
    )
    .forEach((elem) => void twemoji.parse(elem, { size: '72x72' }));
});

// twemoji expects the charset to be UTF-8
if (document.characterSet === 'UTF-8') {
  emojiObs.observe(document.body, { childList: true, subtree: true });
} else {
  console.warn('document charset not utf-8. Emoji replacement disabled.');
}
