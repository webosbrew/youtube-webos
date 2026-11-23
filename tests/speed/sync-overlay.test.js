import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSyncOverlay,
  changeAudioOffset,
  readAudioOffset,
  formatOffset,
  AUDIO_OFFSET_LIMIT_MS
} from '../../src/speed/sync-overlay.js';

function fakeEl() {
  const cls = new Set();
  return {
    textContent: '',
    className: '',
    children: [],
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c)
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    }
  };
}

function fakeWin() {
  const store = new Map();
  const timers = [];
  return {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
    document: { createElement: fakeEl, head: fakeEl(), body: fakeEl() },
    flush: () => {
      for (const f of timers.splice(0)) f();
    }
  };
}

const watching = () => ({
  getVideoData: () => ({ video_id: 'abc' }),
  isInline: () => false
});

function key(type, code) {
  const e = { type, keyCode: code, prevented: false, stopped: false };
  e.preventDefault = () => (e.prevented = true);
  e.stopPropagation = () => {};
  e.stopImmediatePropagation = () => (e.stopped = true);
  return e;
}
const press = (o, code) =>
  ['keydown', 'keypress', 'keyup'].map((t) => o.handleKey(key(t, code)));

test('offsets are clamped and formatted', () => {
  const win = fakeWin();
  assert.equal(readAudioOffset(win), 0);
  assert.equal(changeAudioOffset(win, 30), 30);
  assert.equal(changeAudioOffset(win, 10000), AUDIO_OFFSET_LIMIT_MS);
  assert.equal(formatOffset(30), '+30 ms');
  assert.equal(formatOffset(-20), '-20 ms');
  assert.equal(formatOffset(0), '0 ms');
});

test('RED opens it on a video; LEFT/RIGHT change the offset and apply it', () => {
  const win = fakeWin();
  const changes = [];
  const o = createSyncOverlay(win, {
    getPlayer: watching,
    onChange: (v) => changes.push(v)
  });
  assert.deepEqual(press(o, 403), [true, true, true]);
  assert.ok(o.isOpen());
  press(o, 37);
  press(o, 37);
  press(o, 39);
  assert.deepEqual(changes, [-10, -20, -10]);
  assert.equal(readAudioOffset(win), -10);
  // OK closes it, and its keyup does not reach YouTube.
  assert.deepEqual(press(o, 13), [true, true, true]);
  assert.ok(!o.isOpen());
  // Closed: arrows are YouTube's again.
  assert.deepEqual(press(o, 37), [false, false, false]);
});

test('not on a video: RED is left alone', () => {
  const win = fakeWin();
  const o = createSyncOverlay(win, {
    getPlayer: () => ({ getVideoData: () => ({}) }),
    onChange: () => {}
  });
  assert.deepEqual(press(o, 403), [false, false, false]);
  assert.ok(!o.isOpen());
});

test('another key closes it and goes through', () => {
  const win = fakeWin();
  const o = createSyncOverlay(win, { getPlayer: watching, onChange: () => {} });
  press(o, 403);
  assert.equal(o.handleKey(key('keydown', 405)), false);
  assert.ok(!o.isOpen());
});
