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

function isOverlayCandidate(el) {
  if (!(el instanceof Element)) return false;

  // Ignore our UI container, notifications and core document elements
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'html' || tag === 'body') return false;
  if (el.closest && el.closest('.ytaf-ui-container')) return false;
  if (el.classList && el.classList.contains('ytaf-notification-container'))
    return false;

  // Fast, cheap inline-style check first to avoid costly computed style calls.
  try {
    const inlinePos = el.style && el.style.position;
    const inlineZ = el.style && el.style.zIndex;
    const zInline = inlineZ ? parseInt(inlineZ, 10) || 0 : 0;
    if ((inlinePos === 'fixed' || inlinePos === 'absolute') && zInline >= 1000)
      return true;
  } catch {
    // ignore inline style read errors
  }

  // Fallback: use computed style but with a lower z-index threshold to catch overlays.
  try {
    const style = window.getComputedStyle(el);
    const pos = style.position;
    const z = parseInt(style.zIndex || '0', 10) || 0;
    if ((pos === 'fixed' || pos === 'absolute') && z >= 500) return true;
  } catch {
    // ignore style read errors
  }

  // Heuristics based on aria-labels or id containing cast-related terms.
  try {
    const aria = (
      el.getAttribute &&
      (el.getAttribute('aria-label') || '')
    ).toLowerCase();
    if (
      aria.includes('cast') ||
      aria.includes('chromecast') ||
      aria.includes('background player')
    )
      return true;
    const id = (el.id || '').toLowerCase();
    if (
      id.includes('cast') ||
      id.includes('chromecast') ||
      id.includes('remote-player') ||
      id.includes('background')
    )
      return true;
  } catch {
    // ignore attribute read errors
  }

  return false;
}

function hideOverlayElement(el) {
  try {
    if (!(el instanceof Element)) return false;
    if (el.hasAttribute(OVERLAY_HIDE_ATTR)) return false;
    const tag = (el.tagName || '').toLowerCase();
    // Never hide the root html/body elements
    if (tag === 'html' || tag === 'body') return false;

    // Remember original inline styles in dataset if available (guarded).
    try {
      if (el.dataset)
        el.dataset.ytafOriginalStyle = el.getAttribute('style') || '';
    } catch {
      // ignore if dataset isn't writable
    }

    el.setAttribute(OVERLAY_HIDE_ATTR, '1');
    // Apply imperative hiding with important flags
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    console.info('ytaf: hid overlay element', el);
    return true;
  } catch (e) {
    console.warn('ytaf: failed to hide overlay', e);
    return false;
  }
}

/**
 * Lightweight scanning: only inspect top-level children and their immediate
 * descendants to avoid walking the entire DOM. This is usually sufficient for
 * transient overlay controls injected near the body root.
 */
function scanAndHideOverlays(root = document.body) {
  try {
    let found = false;
    const top = Array.from(root.children);
    for (const n of top) {
      if (isOverlayCandidate(n)) {
        if (hideOverlayElement(n)) found = true;
        continue;
      }
      // shallow scan of direct children
      const kids = Array.from(n.children || []);
      for (const k of kids) {
        if (isOverlayCandidate(k)) {
          if (hideOverlayElement(k)) found = true;
        }
      }
    }
    return found;
  } catch (e) {
    console.warn('ytaf: overlay scan error', e);
    return false;
  }
}

// Debounced mutation processing for responsiveness and low overhead.
const _ytafPendingNodes = new Set();
let _ytafProcessScheduled = false;

function _ytafScheduleProcess() {
  if (_ytafProcessScheduled) return;
  _ytafProcessScheduled = true;
  // Prefer requestAnimationFrame for responsiveness, fallback to setTimeout
  const runner = () => {
    _ytafProcessScheduled = false;
    if (_ytafPendingNodes.size === 0) return;
    const nodes = Array.from(_ytafPendingNodes);
    _ytafPendingNodes.clear();
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (isOverlayCandidate(node)) {
        hideOverlayElement(node);
      } else {
        // shallow scan its children only
        const kids = Array.from(
          (node.children && node.children.length && node.children) || []
        );
        for (const k of kids) {
          if (isOverlayCandidate(k)) hideOverlayElement(k);
        }
      }
    }
  };
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(runner);
  else setTimeout(runner, 50);
}

const _ytafOverlayObserver = new MutationObserver((mutations) => {
  for (const mut of mutations) {
    if (mut.type === 'childList') {
      for (const node of Array.from(mut.addedNodes)) {
        _ytafPendingNodes.add(node);
      }
    } else if (mut.type === 'attributes' && mut.target instanceof Element) {
      // we don't observe attributes to reduce overhead; keep handling branch for safety
      _ytafPendingNodes.add(mut.target);
    }
  }
  _ytafScheduleProcess();
});

// Start observing body for overlays and run an initial lightweight scan.
try {
  // Observe only childList + subtree for low overhead; attribute changes are rare and
  // are handled opportunistically by the debounced processor if observed elsewhere.
  _ytafOverlayObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  // Initial lightweight scan on startup
  scanAndHideOverlays(document.body);
} catch (e) {
  console.warn('ytaf: failed to start overlay observer', e);
}
