/*global navigate, __YTAF_VERSION__*/
import './spatial-navigation-polyfill.js';
import {
  configAddChangeListener,
  configRead,
  configWrite,
  configGetDesc
} from './config.js';
import './ui.css';
import { requireElement } from './player_api/helpers';
import { supportsPlaybackSpeed } from './speed/index.js';
import { AUDIO_OFFSET_KEY } from './speed/controller.js';
import { strings as speedStrings } from './speed/i18n.js';

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

const AUDIO_OFFSET_STEP_MS = 10;
const AUDIO_OFFSET_LIMIT_MS = 400;

function readAudioOffset() {
  try {
    const v = Number(window.localStorage.getItem(AUDIO_OFFSET_KEY));
    return isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Fine A/V sync for the playback-speed audio (it plays through Web Audio, whose
 * output latency to the TV speakers is not fully reported). Applied live.
 */
function createAudioOffsetControl() {
  const row = document.createElement('div');
  row.className = 'ytaf-audio-offset';
  const text = document.createElement('span');
  const earlier = document.createElement('button');
  const later = document.createElement('button');
  const t = speedStrings();
  earlier.textContent = `\u25C0 ${t.earlier}`;
  later.textContent = `${t.later} \u25B6`;

  const render = () => {
    const v = readAudioOffset();
    text.textContent = `${t.audioSync}: ${v > 0 ? '+' : ''}${v} ms\u00A0`;
  };
  const change = (delta) => {
    const v = Math.max(
      -AUDIO_OFFSET_LIMIT_MS,
      Math.min(AUDIO_OFFSET_LIMIT_MS, readAudioOffset() + delta)
    );
    try {
      window.localStorage.setItem(AUDIO_OFFSET_KEY, String(v));
    } catch {
      // not saved; nothing else to do
    }
    render();
  };
  earlier.addEventListener('click', () => change(-AUDIO_OFFSET_STEP_MS));
  later.addEventListener('click', () => change(AUDIO_OFFSET_STEP_MS));

  row.appendChild(text);
  row.appendChild(earlier);
  row.appendChild(later);
  render();
  return row;
}

const PANEL_SCROLL_MARGIN_PX = 16;

/*
 * The options don't all fit on screen, but the panel can't use native
 * scrolling: the YouTube app resets `scrollTop` of scrolled elements back to
 * 0 right away (measured on webOS 6). So the content sits in an inner wrapper
 * that we move with `transform`, and up/down drive it ourselves.
 */

/** @param {HTMLElement} panel */
function panelContent(panel) {
  return /** @type {HTMLElement} */ (panel.querySelector('.ytaf-ui-content'));
}

/**
 * @param {HTMLElement} panel
 * @param {number} offset Pixels the content is moved up.
 */
function setPanelOffset(panel, offset) {
  const content = panelContent(panel);
  const style = window.getComputedStyle(panel);
  const visible =
    panel.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);
  const max = Math.max(0, content.offsetHeight - visible);
  const v = Math.round(Math.max(0, Math.min(max, offset)));
  panel.dataset.offset = String(v);
  content.style.transform = v ? `translateY(${-v}px)` : '';
}

/** @param {HTMLElement} panel */
function getPanelOffset(panel) {
  return Number(panel.dataset.offset) || 0;
}

/**
 * Move the content so the focused control's row is fully visible. The spatial
 * navigation polyfill focuses with `preventScroll` and only picks candidates
 * already on screen, so the options below the fold were unreachable.
 * @param {HTMLElement} panel
 */
function keepFocusedVisible(panel) {
  const elm = document.activeElement;
  if (!elm || elm === panel || !panel.contains(elm)) return;
  const row = elm.closest('label, .ytaf-audio-offset') || elm;
  const p = panel.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const offset = getPanelOffset(panel);
  if (r.top < p.top + PANEL_SCROLL_MARGIN_PX) {
    setPanelOffset(panel, offset - (p.top + PANEL_SCROLL_MARGIN_PX - r.top));
  } else if (r.bottom > p.bottom - PANEL_SCROLL_MARGIN_PX) {
    setPanelOffset(
      panel,
      offset + r.bottom - (p.bottom - PANEL_SCROLL_MARGIN_PX)
    );
  }
}

/**
 * Up/down move through the panel's controls in order, one row at a time
 * (both audio-sync buttons are one row). At the ends, move to the edge so the
 * heading or the footer shows.
 * @param {HTMLElement} panel
 * @param {1 | -1} step
 */
function moveFocusVertically(panel, step) {
  const controls = Array.prototype.slice.call(
    panel.querySelectorAll('input, button')
  );
  const rowOf = (elm) => elm.closest('label, .ytaf-audio-offset') || elm;
  const current = document.activeElement;
  let i = controls.indexOf(current);
  if (i === -1) {
    // Panel itself focused: start at the first (or last) control.
    i = step > 0 ? -1 : controls.length;
  } else {
    const row = rowOf(current);
    while (controls[i + step] && rowOf(controls[i + step]) === row) i += step;
  }
  let next = controls[i + step];
  if (next && step < 0) {
    // Entering a row from below: land on its first control.
    const row = rowOf(next);
    while (controls[i + step - 1] && rowOf(controls[i + step - 1]) === row) {
      i -= 1;
    }
    next = controls[i + step];
  }
  if (next) {
    next.focus({ preventScroll: true });
    // First and last rows also bring the heading or the footer into view.
    if (rowOf(next) === rowOf(controls[0])) setPanelOffset(panel, 0);
    else if (rowOf(next) === rowOf(controls[controls.length - 1])) {
      setPanelOffset(panel, Infinity);
    } else keepFocusedVisible(panel);
  } else {
    setPanelOffset(panel, step > 0 ? Infinity : 0);
  }
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
        const dir = ARROW_KEY_CODE[evt.keyCode];
        if (dir === 'up' || dir === 'down') {
          moveFocusVertically(elmContainer, dir === 'down' ? 1 : -1);
        } else {
          navigate(dir);
          keepFocusedVisible(elmContainer);
        }
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

  const elmContent = document.createElement('div');
  elmContent.className = 'ytaf-ui-content';
  elmContainer.appendChild(elmContent);

  const elmHeading = document.createElement('h1');
  elmHeading.textContent = 'webOS YouTube Extended';
  elmContent.appendChild(elmHeading);

  elmContent.appendChild(createConfigCheckbox('enableAdBlock'));
  elmContent.appendChild(createConfigCheckbox('upgradeThumbnails'));
  elmContent.appendChild(createConfigCheckbox('hideLogo'));
  elmContent.appendChild(createConfigCheckbox('showWatch'));
  elmContent.appendChild(createConfigCheckbox('removeShorts'));
  elmContent.appendChild(createConfigCheckbox('forceHighResVideo'));
  elmContent.appendChild(createConfigCheckbox('removeEndscreen'));
  elmContent.appendChild(createConfigCheckbox('autoAccountSelect'));
  if (supportsPlaybackSpeed(window)) {
    elmContent.appendChild(createConfigCheckbox('enablePlaybackSpeed'));
    elmContent.appendChild(createAudioOffsetControl());
  }
  elmContent.appendChild(createConfigCheckbox('enableSponsorBlock'));

  const elmBlock = document.createElement('blockquote');

  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockSponsor'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockIntro'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockOutro'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockInteraction'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockSelfPromo'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockMusicOfftopic'));
  elmBlock.appendChild(createConfigCheckbox('enableSponsorBlockPreview'));

  elmContent.appendChild(elmBlock);

  const elmSponsorLink = document.createElement('small');
  elmSponsorLink.className = 'ytaf-ui-sponsor';
  elmSponsorLink.textContent =
    'Sponsor segments skipping - https://sponsor.ajay.app';
  elmContent.appendChild(elmSponsorLink);

  const version = document.createElement('div');
  version.className = 'ytaf-ui-version';
  version.textContent = `v${__YTAF_VERSION__}`;

  elmContainer.appendChild(version);

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
    setPanelOffset(optionsPanel, 0);
    optionsPanel.focus({ preventScroll: true });
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
