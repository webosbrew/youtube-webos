/*global navigate*/
import './spatial-navigation-polyfill.js';
import {
  configAddChangeListener,
  configRead,
  configWrite,
  configGetDesc
} from './config.js';
import './ui.css';
import { requireElement } from './player_api/helpers';

// We handle key events ourselves.
window.__spatialNavigation__.keyMode = 'NONE';

const ARROW_KEY_CODE = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

const colorCodeMap = new Map([
  [403, 'red'],

  [404, 'green'],
  [172, 'green'],

  [405, 'yellow'],
  [170, 'yellow'],

  [406, 'blue'],
  [167, 'blue'],
  [191, 'blue']
]);

/**
 * Returns the name of the color button associated with a code or null if not a color button.
 * @param {number} charCode KeyboardEvent.charCode property from event
 * @returns {string | null} Color name or null
 */
function getKeyColor(charCode) {
  if (colorCodeMap.has(charCode)) {
    return colorCodeMap.get(charCode);
  }

  return null;
}

function createConfigCheckbox(key) {
  const elmInput = document.createElement('input');
  elmInput.type = 'checkbox';
  elmInput.checked = configRead(key);

  /** @type {(evt: Event) => void} */
  const changeHandler = (evt) => {
    configWrite(key, evt.target.checked);
  };

  elmInput.addEventListener('change', changeHandler);

  configAddChangeListener(key, (evt) => {
    elmInput.checked = evt.detail.newValue;
  });

  const elmLabel = document.createElement('label');
  elmLabel.appendChild(elmInput);
  // Use non-breaking space (U+00A0)
  elmLabel.appendChild(document.createTextNode('\u00A0' + configGetDesc(key)));

  return elmLabel;
}

function createOptionsPanel() {
  const elmContainer = document.createElement('div');

  elmContainer.classList.add('ytaf-ui-container');
  elmContainer.style['display'] = 'none';
  elmContainer.setAttribute('tabindex', 0);

  elmContainer.addEventListener(
    'focus',
    () => console.debug('Options panel focused!'),
    true
  );
  elmContainer.addEventListener(
    'blur',
    () => console.debug('Options panel blurred!'),
    true
  );

  elmContainer.addEventListener(
    'keydown',
    (evt) => {
      console.debug('Options panel key event:', evt.type, evt.charCode);

      if (getKeyColor(evt.charCode) === 'green') {
        return;
      }

      if (evt.keyCode in ARROW_KEY_CODE) {
        navigate(ARROW_KEY_CODE[evt.keyCode]);
      } else if (evt.keyCode === 13) {
        // "OK" button

        /**
         * The YouTube app generates these "OK" events from clicks (including
         * with the Magic Remote), and we don't want to send a duplicate click
         * event for those. Youtube uses the `Event` class instead of
         * `KeyboardEvent` so we check for that.
         * See issue #143 and #200 for context.
         */
        if (evt instanceof KeyboardEvent) {
          document.activeElement.click();
        }
      } else if (evt.keyCode === 27) {
        // Back button
        showOptionsPanel(false);
      }

      evt.preventDefault();
      evt.stopPropagation();
    },
    true
  );

  const elmHeading = document.createElement('h1');
  elmHeading.textContent = 'webOS YouTube Extended';
  elmContainer.appendChild(elmHeading);

  elmContainer.appendChild(createConfigCheckbox('enableAdBlock'));
  elmContainer.appendChild(createConfigCheckbox('upgradeThumbnails'));
  elmContainer.appendChild(createConfigCheckbox('hideLogo'));
  elmContainer.appendChild(createConfigCheckbox('showWatch'));
  elmContainer.appendChild(createConfigCheckbox('removeShorts'));
  elmContainer.appendChild(createConfigCheckbox('forceHighResVideo'));
  elmContainer.appendChild(createConfigCheckbox('removeEndscreen'));
  elmContainer.appendChild(createConfigCheckbox('enableSponsorBlock'));

  const elmBlock = document.createElement('blockquote');

  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockSponsor'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockIntro'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockOutro'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockInteraction'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockSelfPromo'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockMusicOfftopic'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockPreview'));

  elmContainer.appendChild(elmBlock);

  const elmSponsorLink = document.createElement('div');
  elmSponsorLink.innerHTML =
    '<small class="ytaf-ui-sponsor">Sponsor segments skipping - https://sponsor.ajay.app</small>';
  elmContainer.appendChild(elmSponsorLink);

  return elmContainer;
}

const optionsPanel = createOptionsPanel();
document.body.appendChild(optionsPanel);

let optionsPanelVisible = false;

/**
 * Show or hide the options panel.
 * @param {boolean} [visible=true] Whether to show the options panel.
 */
function showOptionsPanel(visible) {
  visible ??= true;

  if (visible && !optionsPanelVisible) {
    console.debug('Showing and focusing options panel!');
    optionsPanel.style.display = 'block';
    optionsPanel.focus();
    optionsPanelVisible = true;
  } else if (!visible && optionsPanelVisible) {
    console.debug('Hiding options panel!');
    optionsPanel.style.display = 'none';
    optionsPanel.blur();
    optionsPanelVisible = false;
  }
}

window.ytaf_showOptionsPanel = showOptionsPanel;

const eventHandler = (evt) => {
  console.debug(
    'Key event:',
    evt.type,
    evt.charCode,
    evt.keyCode,
    evt.defaultPrevented
  );

  if (getKeyColor(evt.charCode) === 'green') {
    console.debug('Taking over!');

    evt.preventDefault();
    evt.stopPropagation();

    if (evt.type === 'keydown') {
      // Toggle visibility.
      showOptionsPanel(!optionsPanelVisible);
    }
    return false;
  } else if (getKeyColor(evt.charCode) === 'blue') {
    evt.preventDefault();
    evt.stopPropagation();

    if (evt.type === 'keydown') {
      // Toggle Audio-Only mode.
      initAudioOnlyToggle();
    }
    return false;
  }
  return true;
};

document.addEventListener('keydown', eventHandler, true);
document.addEventListener('keypress', eventHandler, true);
document.addEventListener('keyup', eventHandler, true);

const COLOR_MAP = {
  red: 'rgba(255, 0, 0, 0.9)',
  green: 'rgba(0, 162, 0, 0.9)',
  yellow: 'rgba(255, 255, 0, 0.9)',
  blue: 'rgba(0, 128, 255, 0.9)',
  grey: 'rgba(255, 255, 255, 0.5)',
  none: 'rgba(0, 0, 0, 0)'
};

export function showNotification(text, time = 3000, color = 'grey') {
  if (!document.querySelector('.ytaf-notification-container')) {
    console.debug('Adding notification container');
    const c = document.createElement('div');
    c.classList.add('ytaf-notification-container');
    document.body.appendChild(c);
  }

  const elm = document.createElement('div');
  const elmInner = document.createElement('div');
  elmInner.innerText = text;
  elmInner.classList.add('message');
  elmInner.classList.add('message-hidden');
  elm.appendChild(elmInner);
  document.querySelector('.ytaf-notification-container').appendChild(elm);
  elmInner.style.borderColor = COLOR_MAP[color] || color;

  setTimeout(() => {
    elmInner.classList.remove('message-hidden');
  }, 100);
  setTimeout(() => {
    elmInner.classList.add('message-hidden');
    setTimeout(() => {
      elm.remove();
    }, 1000);
  }, time);
}

/**
 * Initialize ability to hide YouTube logo in top right corner.
 */
function initHideLogo() {
  const style = document.createElement('style');
  document.head.appendChild(style);

  /** @type {(hide: boolean) => void} */
  const setHidden = (hide) => {
    const visibility = hide ? 'hidden' : 'visible';
    style.textContent = `ytlr-redux-connect-ytlr-logo-entity { visibility: ${visibility}; }`;
  };

  setHidden(configRead('hideLogo'));

  configAddChangeListener('hideLogo', (evt) => {
    setHidden(evt.detail.newValue);
  });
}

function applyUIFixes() {
  try {
    const bodyClasses = document.body.classList;

    const observer = new MutationObserver(function bodyClassCallback(
      _records,
      _observer
    ) {
      try {
        if (bodyClasses.contains('app-quality-root')) {
          bodyClasses.remove('app-quality-root');
        }
      } catch (e) {
        console.error('error in <body> class observer callback:', e);
      }
    });

    observer.observe(document.body, {
      subtree: false,
      childList: false,
      attributes: true,
      attributeFilter: ['class'],
      characterData: false
    });
  } catch (e) {
    console.error('error setting up <body> class observer:', e);
  }
}

let audioOnlyEnabled = false;
let overlayObserver = null;

async function initAudioOnlyToggle() {
  const elVideo = await requireElement('video', HTMLVideoElement);

  audioOnlyEnabled = !audioOnlyEnabled;
  elVideo.style.visibility = audioOnlyEnabled ? 'hidden' : '';

  const AUDIO_OVERLAY_SELECTOR = '.ytLrAudioPlayerOverlayAudioMode';
  const YTAF_OVERLAY_CLASS = 'ytaf-ui-watchControl-overlayMessage';

  const applyAudioOverlayFilter = () => {
    const node = document.querySelector(AUDIO_OVERLAY_SELECTOR);
    if (!node) return;
    if (audioOnlyEnabled) {
      node.style.setProperty('filter', 'brightness(0)', 'important');
    } else {
      node.style.removeProperty('filter');
    }
  };
  applyAudioOverlayFilter();

  showNotification(
    `Audio-Only mode: ${audioOnlyEnabled ? 'Enabled' : 'Disabled'}`,
    2000,
    'blue'
  );

  const controlsContainer = await requireElement(
    '[idomkey="controls"]',
    HTMLElement
  );

  const updateOverlay = (root = controlsContainer) => {
    let overlay = root.querySelector(`.${YTAF_OVERLAY_CLASS}`);

    if (!audioOnlyEnabled) {
      overlay?.remove();
      return;
    }

    if (overlay) return;

    overlay = Object.assign(document.createElement('div'), {
      textContent: 'Audio-Only Mode Enabled - Press [BLUE] to toggle',
      className: YTAF_OVERLAY_CLASS
    });
    root.prepend(overlay);
  };
  updateOverlay();

  if (overlayObserver) overlayObserver.disconnect();
  overlayObserver = new MutationObserver(() => {
    updateOverlay();
    applyAudioOverlayFilter();
  });

  overlayObserver.observe(controlsContainer, {
    childList: true,
    subtree: true
  });
}

applyUIFixes();
initHideLogo();

setTimeout(() => {
  showNotification(
    'Press [GREEN] to open YTAF configuration screen',
    2000,
    'green'
  );
});

// Detect and hide transient system overlay controls that steal focus (e.g. Chromecast UI).
// Strategy: observe added nodes and existing nodes for high z-index, fixed positioning,
// and not belonging to our YTAF UI, then hide them. Also suppress the 'Up' navigation
// that switches focus to a background player while overlays are present.
const OVERLAY_HIDE_ATTR = 'data-ytaf-hidden-overlay';
const HIDE_Z = 400;

// Simplified, named overlay + autoplay helpers (no anonymous IIFE, functions at module scope).

function isOverlayCandidate(el) {
  if (!(el instanceof Element)) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'html' || tag === 'body') return false;
  if (el.closest && el.closest('.ytaf-ui-container')) return false;
  if (el.classList && el.classList.contains('ytaf-notification-container'))
    return false;
  try {
    if (
      (el.querySelector && el.querySelector('video')) ||
      (el.querySelector && el.querySelector('[idomkey="controls"]'))
    )
      return false;
  } catch {
    //
  }
  try {
    const st = window.getComputedStyle(el);
    const pos = st.position;
    const z = parseInt(st.zIndex || '0', 10) || 0;
    if ((pos === 'fixed' || pos === 'absolute') && z >= HIDE_Z) return true;
  } catch {
    /* ignore */
  }
  try {
    const a = (
      el.getAttribute &&
      (el.getAttribute('aria-label') || '')
    ).toLowerCase();
    const id = (el.id || '').toLowerCase();
    if (
      a.includes('cast') ||
      id.includes('cast') ||
      a.includes('chromecast') ||
      id.includes('chromecast')
    )
      return true;
  } catch {
    /* ignore */
  }
  return false;
}

function hideOverlayElement(el) {
  try {
    if (!(el instanceof Element)) return false;
    if (el.hasAttribute(OVERLAY_HIDE_ATTR)) return false;
    el.setAttribute(OVERLAY_HIDE_ATTR, '1');
    try {
      if (el.dataset)
        el.dataset.ytafOriginalStyle = el.getAttribute('style') || '';
    } catch {
      /* ignore */
    }
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    return true;
  } catch {
    return false;
  }
}

function scanAndHideOverlays(root = document.body) {
  try {
    let hid = false;
    for (const n of Array.from(root.children || [])) {
      if (isOverlayCandidate(n)) {
        if (hideOverlayElement(n)) hid = true;
        continue;
      }
      for (const c of Array.from(n.children || []))
        if (isOverlayCandidate(c) && hideOverlayElement(c)) hid = true;
    }
    if (hid) {
      // small delayed resume attempt
      setTimeout(() => {
        try {
          const v = document.querySelector('video');
          if (!v || !(v instanceof HTMLVideoElement)) return;
          if (!v.paused && !v.ended) return;
          v.play().catch(() => {
            try {
              const prev = v.muted;
              v.muted = true;
              v.play()
                .then(() => {
                  setTimeout(() => {
                    try {
                      if (!prev) v.muted = false;
                    } catch {
                      /* ignore */
                    }
                  }, 600);
                })
                .catch(() => {});
            } catch {
              /* ignore */
            }
          });
        } catch {
          /* ignore */
        }
      }, 80);
    }
    return hid;
  } catch {
    return false;
  }
}

const _pending = new Set();
let _scheduled = false;
function scheduleProcess() {
  if (_scheduled) return;
  _scheduled = true;
  const run = () => {
    _scheduled = false;
    const nodes = Array.from(_pending);
    _pending.clear();
    for (const n of nodes) {
      if (!(n instanceof Element)) continue;
      if (isOverlayCandidate(n)) hideOverlayElement(n);
      else
        for (const c of Array.from(n.children || []))
          if (isOverlayCandidate(c)) hideOverlayElement(c);
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 50);
}

let overlayMutationObserver = null;
function startOverlayObserver() {
  try {
    overlayMutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations)
        if (m.type === 'childList')
          for (const n of Array.from(m.addedNodes || [])) _pending.add(n);
      scheduleProcess();
    });
    overlayMutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    scanAndHideOverlays(document.body);
  } catch {
    /* ignore */
  }
}

function tryAutoPlayVideo(v) {
  try {
    if (!v || !(v instanceof HTMLVideoElement)) return;
    const src = v.currentSrc || v.src || '';
    if (v.getAttribute('data-ytaf-autoplay-src') === src) return;
    v.setAttribute('data-ytaf-autoplay-src', src);
    if (!v.paused && !v.ended) return;

    const attempt = () => {
      try {
        const p = v.play();
        if (p && typeof p.then === 'function') {
          p.catch(() => {
            try {
              const prev = v.muted;
              v.muted = true;
              const f = v.play();
              if (f && typeof f.then === 'function')
                f.then(() => {
                  setTimeout(() => {
                    try {
                      if (!prev) v.muted = false;
                    } catch {
                      /* ignore */
                    }
                  }, 600);
                }).catch(() => {});
            } catch {
              /* ignore */
            }
          });
        }
      } catch {
        /* ignore */
      }
    };

    v.addEventListener('canplay', attempt, { once: true, passive: true });
    v.addEventListener('loadedmetadata', attempt, {
      once: true,
      passive: true
    });
    setTimeout(attempt, 120);
  } catch {
    /* ignore */
  }
}

let videoMutationObserver = null;
function startVideoObserver() {
  try {
    videoMutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const n of Array.from(m.addedNodes || [])) {
            try {
              if (!n || n.nodeType !== Node.ELEMENT_NODE) continue;
              const el = n;
              if (el.tagName && el.tagName.toLowerCase() === 'video') {
                tryAutoPlayVideo(el);
                continue;
              }
              const vid = el.querySelector && el.querySelector('video');
              if (vid) tryAutoPlayVideo(vid);
            } catch {
              /* ignore */
            }
          }
        } else if (
          m.type === 'attributes' &&
          m.target instanceof HTMLVideoElement
        ) {
          tryAutoPlayVideo(m.target);
        }
      }
    });
    videoMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
    const existing = document.querySelector('video');
    if (existing) tryAutoPlayVideo(existing);
  } catch {
    /* ignore */
  }
}

function onNavigationHook() {
  setTimeout(() => {
    try {
      scanAndHideOverlays(document.body);
    } catch {
      /* ignore */
    }
    const v = document.querySelector('video');
    if (v) tryAutoPlayVideo(v);
  }, 100);
}

function patchHistoryForNav() {
  try {
    const _push = history.pushState;
    const _replace = history.replaceState;
    history.pushState = function () {
      try {
        const r = _push.apply(this, arguments);
        onNavigationHook();
        return r;
      } catch {
        return _push.apply(this, arguments);
      }
    };
    history.replaceState = function () {
      try {
        const r = _replace.apply(this, arguments);
        onNavigationHook();
        return r;
      } catch {
        return _replace.apply(this, arguments);
      }
    };
    window.addEventListener('popstate', onNavigationHook, true);
    document.addEventListener(
      'click',
      (evt) => {
        try {
          if (!evt || !evt.isTrusted) return;
          let n = evt.target;
          while (n && n !== document.body) {
            if (n.tagName && n.tagName.toLowerCase() === 'a') {
              const href = n.getAttribute('href') || '';
              if (href.includes('/watch') || href.includes('watch?v=')) {
                setTimeout(onNavigationHook, 80);
                return;
              }
            }
            n = n.parentElement;
          }
        } catch {
          /* ignore */
        }
      },
      true
    );
  } catch {
    /* ignore */
  }
}

// Initialize observers and hooks
startOverlayObserver();
startVideoObserver();
patchHistoryForNav();
