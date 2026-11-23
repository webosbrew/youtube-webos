/**
 * On-screen countdown for a live speed change, then a confirmation, in the
 * style of an Apple HUD: a translucent pill at the top of the screen with a
 * progress ring around the target speed, which turns green with a check mark
 * when the new speed is playing.
 */

const POLL_MS = 100;
const DONE_HOLD_MS = 1800;
const GIVE_UP_MS = 25000;
const RING_R = 27;
const RING_C = 2 * Math.PI * RING_R;

import { strings, formatSpeed as fmt, uiLanguage } from './i18n.js';

export function formatSpeed(speed, lang = uiLanguage()) {
  return fmt(speed, lang);
}

/**
 * What the toast shows for a status from mse-hook switchStatus().
 * @param {{state: string, target: number, etaS: number} | null} status
 * @param {number} speed the speed asked for
 * @param {number} maxEta the largest eta seen since the request
 */
export function toastModel(status, speed, maxEta, lang = uiLanguage()) {
  const t = strings(lang);
  const label = formatSpeed(speed, lang);
  if (!status || status.target !== speed) {
    return { phase: 'hidden' };
  }
  if (status.state === 'done' || status.etaS <= 0.05) {
    return {
      phase: 'done',
      ring: label,
      title: speed === 1 ? t.normalSpeed : t.speedIs(label),
      subtitle: t.activeNow,
      progress: 1
    };
  }
  const secs = Math.max(1, Math.ceil(status.etaS));
  return {
    phase: 'counting',
    ring: label,
    title: speed === 1 ? t.backToNormal : t.changingTo(label),
    subtitle: t.inSeconds(secs),
    progress: maxEta > 0 ? Math.min(1, Math.max(0, status.etaS / maxEta)) : 1
  };
}

const CSS = `
.ytaf-speed-toast {
  position: fixed;
  top: 56px;
  left: 50%;
  z-index: 2147483000;
  pointer-events: none;
  display: flex;
  align-items: center;
  height: 104px;
  padding: 0 44px 0 22px;
  border-radius: 52px;
  /* No backdrop-filter or box-shadow: over the webOS hardware video plane
     they make the browser composite an opaque layer, a big black rectangle
     around the pill. A plain translucent fill blends like YTAF's own
     notifications. */
  background: rgba(22, 22, 24, 0.82);
  border: 1.5px solid rgba(255, 255, 255, 0.16);
  color: #fff;
  font-family: 'SF Pro Display', Roboto, Arial, sans-serif;
  opacity: 0;
  transform: translate(-50%, -24px) scale(0.92);
  transition: opacity 0.32s ease, transform 0.46s cubic-bezier(0.2, 0.9, 0.25, 1.18);
}
.ytaf-speed-toast.ytaf-on {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
.ytaf-speed-toast.ytaf-pop {
  transform: translate(-50%, 0) scale(1.045);
}
.ytaf-speed-toast .ytaf-ring {
  position: relative;
  width: 64px;
  height: 64px;
  margin-right: 22px;
  flex: none;
}
.ytaf-speed-toast svg {
  position: absolute;
  left: 0;
  top: 0;
  width: 64px;
  height: 64px;
  transform: rotate(-90deg);
}
.ytaf-speed-toast .ytaf-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 5;
}
.ytaf-speed-toast .ytaf-arc {
  fill: none;
  stroke: #fff;
  stroke-width: 5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.12s linear, stroke 0.3s ease;
}
.ytaf-speed-toast.ytaf-done .ytaf-arc {
  stroke: #34c759;
  transition: stroke-dashoffset 0.35s ease, stroke 0.3s ease;
}
.ytaf-speed-toast .ytaf-ring-label {
  position: absolute;
  left: 0;
  top: 0;
  width: 64px;
  line-height: 64px;
  text-align: center;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.02em;
  transition: opacity 0.2s ease, transform 0.3s ease;
}
.ytaf-speed-toast .ytaf-check {
  position: absolute;
  left: 0;
  top: 0;
  width: 64px;
  height: 64px;
  transform: none;
}
.ytaf-speed-toast .ytaf-check path {
  fill: none;
  stroke: #34c759;
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 40;
  stroke-dashoffset: 40;
  transition: stroke-dashoffset 0.4s ease 0.12s;
}
.ytaf-speed-toast.ytaf-done .ytaf-check path {
  stroke-dashoffset: 0;
}
.ytaf-speed-toast.ytaf-done .ytaf-ring-label {
  opacity: 0;
  transform: scale(0.6);
}
.ytaf-speed-toast .ytaf-title {
  font-size: 31px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 38px;
  white-space: nowrap;
}
.ytaf-speed-toast .ytaf-subtitle {
  font-size: 23px;
  line-height: 30px;
  color: rgba(255, 255, 255, 0.62);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(doc, name, attrs) {
  const el = doc.createElementNS(SVG_NS, name);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

export function createSpeedToast(win, getStatus) {
  const doc = win.document;
  let root = null;
  let parts = null;
  let timer = null;
  let hideTimer = null;
  let speed = null;
  let maxEta = 0;
  let startedAt = 0;
  let phase = 'hidden';

  function build() {
    if (root) return;
    const style = doc.createElement('style');
    style.textContent = CSS;
    (doc.head || doc.body).appendChild(style);

    root = doc.createElement('div');
    root.className = 'ytaf-speed-toast';
    const ring = doc.createElement('div');
    ring.className = 'ytaf-ring';
    const svg = svgEl(doc, 'svg', { viewBox: '0 0 64 64' });
    svg.appendChild(
      svgEl(doc, 'circle', { class: 'ytaf-track', cx: 32, cy: 32, r: RING_R })
    );
    const arc = svgEl(doc, 'circle', {
      class: 'ytaf-arc',
      cx: 32,
      cy: 32,
      r: RING_R,
      'stroke-dasharray': RING_C.toFixed(2),
      'stroke-dashoffset': '0'
    });
    svg.appendChild(arc);
    const check = svgEl(doc, 'svg', {
      class: 'ytaf-check',
      viewBox: '0 0 64 64'
    });
    check.appendChild(svgEl(doc, 'path', { d: 'M20 33 L28.5 41.5 L44.5 24' }));
    const label = doc.createElement('div');
    label.className = 'ytaf-ring-label';
    ring.appendChild(svg);
    ring.appendChild(check);
    ring.appendChild(label);

    const text = doc.createElement('div');
    const title = doc.createElement('div');
    title.className = 'ytaf-title';
    const subtitle = doc.createElement('div');
    subtitle.className = 'ytaf-subtitle';
    text.appendChild(title);
    text.appendChild(subtitle);

    root.appendChild(ring);
    root.appendChild(text);
    doc.body.appendChild(root);
    parts = { arc, label, title, subtitle };
  }

  function setClass(name, on) {
    if (on) root.classList.add(name);
    else root.classList.remove(name);
  }

  function render(model) {
    parts.label.textContent = model.ring;
    parts.title.textContent = model.title;
    parts.subtitle.textContent = model.subtitle;
    parts.arc.setAttribute(
      'stroke-dashoffset',
      (RING_C * (1 - model.progress)).toFixed(2)
    );
  }

  function stop() {
    if (timer !== null) win.clearInterval(timer);
    timer = null;
  }

  function hide() {
    stop();
    if (hideTimer !== null) win.clearTimeout(hideTimer);
    hideTimer = null;
    phase = 'hidden';
    if (root) {
      setClass('ytaf-on', false);
      setClass('ytaf-pop', false);
    }
  }

  function tick() {
    let status;
    try {
      status = getStatus();
    } catch {
      status = null;
    }
    if (status && status.state !== 'done' && status.target === speed) {
      maxEta = Math.max(maxEta, status.etaS);
    }
    const model = toastModel(status, speed, maxEta);
    if (model.phase === 'hidden' || Date.now() - startedAt > GIVE_UP_MS) {
      hide();
      return;
    }
    render(model);
    if (model.phase === 'done' && phase !== 'done') {
      phase = 'done';
      stop();
      setClass('ytaf-done', true);
      setClass('ytaf-pop', true);
      win.setTimeout(() => setClass('ytaf-pop', false), 220);
      hideTimer = win.setTimeout(hide, DONE_HOLD_MS);
    } else if (model.phase === 'counting') {
      phase = 'counting';
    }
  }

  function show(newSpeed) {
    build();
    if (hideTimer !== null) win.clearTimeout(hideTimer);
    hideTimer = null;
    stop();
    speed = newSpeed;
    maxEta = 0;
    startedAt = Date.now();
    phase = 'counting';
    setClass('ytaf-done', false);
    // Let the styles apply before the entrance transition.
    win.setTimeout(() => {
      if (phase !== 'hidden') setClass('ytaf-on', true);
    }, 16);
    tick();
    if (phase !== 'hidden' && phase !== 'done') {
      timer = win.setInterval(tick, POLL_MS);
    }
  }

  return { show, hide };
}
