/**
 * Audio sync adjustment from the remote: RED opens a small pill at the top of
 * the screen (same look as the speed toast), LEFT/RIGHT move the audio 10 ms
 * earlier/later, applied at once, and OK, BACK or RED close it. The settings
 * panel covered most of the picture, so the lips could not be watched while
 * adjusting.
 */
import { AUDIO_OFFSET_KEY, DEFAULT_AUDIO_OFFSET_MS } from './controller.js';
import { strings } from './i18n.js';

export const AUDIO_OFFSET_STEP_MS = 10;
export const AUDIO_OFFSET_LIMIT_MS = 400;
const IDLE_HIDE_MS = 8000;

const KEY = {
  red: [403],
  left: [37],
  right: [39],
  close: [13, 27, 461, 403]
};

/** @param {Window} win */
export function readAudioOffset(win) {
  try {
    const raw = win.localStorage.getItem(AUDIO_OFFSET_KEY);
    const v = Number(raw);
    return raw === null || raw === undefined || !isFinite(v)
      ? DEFAULT_AUDIO_OFFSET_MS
      : v;
  } catch {
    return DEFAULT_AUDIO_OFFSET_MS;
  }
}

/**
 * Moves the stored offset by `delta` ms, within the limit.
 * @param {Window} win
 * @param {number} delta
 * @returns {number} the new offset
 */
export function changeAudioOffset(win, delta) {
  const v = Math.max(
    -AUDIO_OFFSET_LIMIT_MS,
    Math.min(AUDIO_OFFSET_LIMIT_MS, readAudioOffset(win) + delta)
  );
  try {
    win.localStorage.setItem(AUDIO_OFFSET_KEY, String(v));
  } catch {
    // not saved; nothing else to do
  }
  return v;
}

export function formatOffset(v) {
  return `${v > 0 ? '+' : ''}${v} ms`;
}

const CSS = `
.ytaf-sync-pill {
  position: fixed;
  top: 56px;
  left: 50%;
  z-index: 2147483001;
  pointer-events: none;
  display: flex;
  align-items: center;
  height: 104px;
  padding: 0 44px 0 22px;
  border-radius: 52px;
  /* No backdrop-filter or box-shadow: a black rectangle over the video. */
  background: rgba(22, 22, 24, 0.82);
  border: 1.5px solid rgba(255, 255, 255, 0.16);
  color: #fff;
  font-family: 'SF Pro Display', Roboto, Arial, sans-serif;
  opacity: 0;
  transform: translate(-50%, -24px) scale(0.92);
  transition: opacity 0.32s ease, transform 0.46s cubic-bezier(0.2, 0.9, 0.25, 1.18);
}
.ytaf-sync-pill.ytaf-on {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
.ytaf-sync-pill .ytaf-sync-value {
  min-width: 120px;
  height: 64px;
  margin-right: 22px;
  padding: 0 14px;
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.14);
  font-size: 27px;
  font-weight: 700;
  line-height: 64px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ytaf-sync-pill .ytaf-title {
  font-size: 31px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 38px;
  white-space: nowrap;
}
.ytaf-sync-pill .ytaf-subtitle {
  font-size: 23px;
  line-height: 30px;
  color: rgba(255, 255, 255, 0.62);
  white-space: nowrap;
}
`;

/**
 * @param {Window} win
 * @param {{ getPlayer: () => any, onChange: (ms: number) => void }} opts
 */
export function createSyncOverlay(win, { getPlayer, onChange }) {
  const doc = win.document;
  let root = null;
  let valueEl = null;
  let open = false;
  let idleTimer = null;
  // The key that closed the pill: its keypress/keyup are not YouTube's.
  let eat = null;

  function build() {
    if (root) return;
    const style = doc.createElement('style');
    style.textContent = CSS;
    (doc.head || doc.body).appendChild(style);
    const t = strings();
    root = doc.createElement('div');
    root.className = 'ytaf-sync-pill';
    valueEl = doc.createElement('div');
    valueEl.className = 'ytaf-sync-value';
    const text = doc.createElement('div');
    const title = doc.createElement('div');
    title.className = 'ytaf-title';
    title.textContent = t.syncTitle;
    const hint = doc.createElement('div');
    hint.className = 'ytaf-subtitle';
    hint.textContent = t.syncHint;
    text.appendChild(title);
    text.appendChild(hint);
    root.appendChild(valueEl);
    root.appendChild(text);
    doc.body.appendChild(root);
  }

  function armIdle() {
    if (idleTimer !== null) win.clearTimeout(idleTimer);
    idleTimer = win.setTimeout(hide, IDLE_HIDE_MS);
  }

  function render() {
    valueEl.textContent = formatOffset(readAudioOffset(win));
  }

  function show() {
    build();
    render();
    open = true;
    win.setTimeout(() => {
      if (open) root.classList.add('ytaf-on');
    }, 16);
    armIdle();
  }

  function hide() {
    open = false;
    if (idleTimer !== null) win.clearTimeout(idleTimer);
    idleTimer = null;
    if (root) root.classList.remove('ytaf-on');
  }

  function step(delta) {
    const v = changeAudioOffset(win, delta);
    render();
    armIdle();
    onChange(v);
  }

  function onWatch() {
    try {
      const p = getPlayer();
      return (
        !!(p && p.getVideoData && p.getVideoData()?.video_id) &&
        !(p.isInline && p.isInline())
      );
    } catch {
      return false;
    }
  }

  const swallow = (evt) => {
    evt.preventDefault();
    if (evt.stopPropagation) evt.stopPropagation();
    if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
  };

  /** Capture-phase key handler. @returns {boolean} true if it took the key. */
  function handleKey(evt) {
    const code = evt.keyCode || evt.charCode;
    if (eat !== null && code === eat && evt.type !== 'keydown') {
      swallow(evt);
      if (evt.type === 'keyup') eat = null;
      return true;
    }
    if (!open) {
      if (!KEY.red.includes(code) || evt.defaultPrevented || !onWatch())
        return false;
      swallow(evt);
      if (evt.type === 'keydown') show();
      return true;
    }
    if (KEY.left.includes(code) || KEY.right.includes(code)) {
      swallow(evt);
      if (evt.type === 'keydown')
        step(
          KEY.left.includes(code) ? -AUDIO_OFFSET_STEP_MS : AUDIO_OFFSET_STEP_MS
        );
      return true;
    }
    if (KEY.close.includes(code) || code === 38 || code === 40) {
      swallow(evt);
      if (evt.type === 'keydown' && code !== 38 && code !== 40) {
        hide();
        eat = code;
      }
      return true;
    }
    // Any other key: let it through and get out of the way.
    if (evt.type === 'keydown') hide();
    return false;
  }

  return { handleKey, show, hide, isOpen: () => open };
}
