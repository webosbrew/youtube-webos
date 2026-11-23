/* eslint-disable no-await-in-loop -- appends must run one after another, like YouTube does */
// Live speed changes: the speed of a playing MediaSource changes from a fragment
// boundary ahead of the playhead, without reloading the video (no black screen).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFakeWindow } from './fakes.js';
import { installMseHook, LIVE_AHEAD_CAP_S } from '../../src/speed/mse-hook.js';
import { SpeedTimeMap } from '../../src/speed/timemap.js';
import { parseBoxes, findMdhdTimescale } from '../../src/speed/isobmff.js';

const yt136 = new Uint8Array(
  readFileSync(new URL('./fixtures/yt_136.bin', import.meta.url))
);
const boxes = parseBoxes(yt136, 0, yt136.length);
const moofBox = boxes.find((b) => b.type === 'moof');
const INIT = yt136.slice(0, moofBox.start);
const MOOF = yt136.slice(moofBox.start, moofBox.end);
const TS = findMdhdTimescale(INIT).timescale;

function tfdtOffset(moof) {
  const s = Buffer.from(moof).indexOf('tfdt');
  return s + 4; // FullBox version byte
}

/** A media fragment (moof + tiny mdat) starting at `seconds`. */
function fragment(seconds) {
  const moof = MOOF.slice();
  const p = tfdtOffset(moof);
  const view = new DataView(moof.buffer);
  const ticks = Math.round(seconds * TS);
  if (moof[p] === 1) {
    view.setUint32(p + 4, Math.floor(ticks / 0x100000000));
    view.setUint32(p + 8, ticks >>> 0);
  } else {
    view.setUint32(p + 4, ticks);
  }
  const mdat = new Uint8Array([
    0, 0, 0, 12, 0x6d, 0x64, 0x61, 0x74, 1, 2, 3, 4
  ]);
  const out = new Uint8Array(moof.length + mdat.length);
  out.set(moof, 0);
  out.set(mdat, moof.length);
  return out;
}

// A playhead this close to the end of a 0-10 s buffer is under the cap.
const NEAR_END = 10 - LIVE_AHEAD_CAP_S / 2;
const timescaleOf = (u8) => findMdhdTimescale(u8)?.timescale;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup({ speed = 1, presetDuration } = {}) {
  const win = makeFakeWindow();
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  // Real SourceBuffers end a remove() with updateend, like an append.
  win.SourceBuffer.prototype.remove = function (s, e) {
    this.removed.push([s, e]);
    this.updating = true;
    queueMicrotask(() => {
      this.updating = false;
      this.dispatchEvent(new win.Event('updateend'));
    });
  };
  const sinks = [];
  const hook = installMseHook(win, {
    getSpeed: () => speed,
    createAudioSink: (o) => {
      const sink = { o, configure() {}, push() {}, discard() {}, reset() {} };
      sinks.push(sink);
      return sink;
    },
    onRateRequest() {},
    onError: (e) => {
      throw e;
    },
    useLive: () => true
  });
  const ms = new win.MediaSource();
  ms.readyState = 'open';
  if (presetDuration !== undefined) ms._d = presetDuration;
  const el = win.document.createElement('video');
  el.src = win.URL.createObjectURL(ms);
  const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  const real = ms._sbs[0];
  return { win, hook, ms, el, sb, real, sinks };
}

async function append(sb, u8) {
  sb.appendBuffer(u8);
  await flush();
}

describe('SpeedTimeMap segments', () => {
  test('piecewise, continuous, invertible', () => {
    const m = new SpeedTimeMap(1);
    m.addSegment(10, 2);
    assert.equal(m.toElement(10), 10);
    assert.equal(m.toElement(14), 12);
    assert.equal(m.toContent(12), 14);
    assert.equal(m.toContent(5), 5);
    assert.equal(m.speedAtContent(9.99), 1);
    assert.equal(m.speedAtContent(10), 2);
    m.addSegment(20, 0.5); // element 15
    assert.equal(m.toElement(21), 17);
    assert.equal(m.toContent(17), 21);
    // A new segment before a later one replaces it.
    m.addSegment(12, 1.5);
    assert.equal(m.segments.length, 3);
    assert.equal(m.toElement(15), 11 + 3 / 1.5);
    assert.equal(m.toElement(Infinity), Infinity);
  });

  test('a segment at 0 replaces everything', () => {
    const m = new SpeedTimeMap(2);
    m.addSegment(0, 1);
    assert.deepEqual(m.segments, [{ c0: 0, e0: 0, s: 1 }]);
  });
});

describe('live session', () => {
  test('1x live: the audio goes to the engine, the init is untouched', async () => {
    const { ms, real, sb, sinks } = setup();
    assert.equal(ms._sbs.length, 1, 'only the video SourceBuffer is real');
    assert.equal(typeof sinks[0].o.speedAt, 'function');
    await append(sb, INIT);
    assert.equal(timescaleOf(real.appended[0]), TS);
  });

  test('switch: no removal, the next fragment appended gets the new scale', async () => {
    const { hook, el, sb, real } = setup();
    await append(sb, INIT);
    for (const t of [0, 5]) await append(sb, fragment(t));
    real._ranges = [[0, 10]];
    el.currentTime = NEAR_END; // under the cap: appends go through
    real.appended.length = 0;

    assert.equal(hook.switchSpeed(2), true);
    await flush();
    assert.deepEqual(real.removed, [], 'nothing buffered is removed');
    assert.equal(el.playbackRate, 2);
    assert.equal(
      el.currentTime,
      NEAR_END,
      'the buffered part keeps its 1x map'
    );

    await append(sb, fragment(10));
    assert.equal(real.appended.length, 2, 'init re-appended before it');
    assert.equal(timescaleOf(real.appended[0]), TS * 2);
    assert.equal(real._ts, 10 - 10 / 2);
    await append(sb, fragment(15));
    assert.equal(real.appended.length, 3, 'no second init');
    real._ranges = [[0, 12.5]];
    assert.equal(sb.buffered.end(0), 15);
  });

  test('appends wait while more than the cap is buffered ahead', async () => {
    const { sb, el, real } = setup();
    await append(sb, INIT);
    await append(sb, fragment(0));
    real._ranges = [[0, 10]];
    el._ct = 1; // playback, not a seek // 9 s ahead
    real.appended.length = 0;
    let ends = 0;
    sb.addEventListener('updateend', () => ends++);
    sb.appendBuffer(fragment(10));
    await sleep(150);
    assert.equal(real.appended.length, 0, 'held');
    assert.equal(sb.updating, true, 'YouTube waits');
    el._ct = NEAR_END; // under the cap
    await sleep(250);
    assert.equal(real.appended.length, 1, 'released');
    assert.equal(ends, 1, 'one updateend for the one append');
    assert.equal(sb.updating, false);
  });

  test('a switch during a held append applies to it', async () => {
    const { hook, sb, el, real } = setup();
    await append(sb, INIT);
    await append(sb, fragment(0));
    real._ranges = [[0, 10]];
    el._ct = 1; // playback, not a seek
    real.appended.length = 0;
    sb.appendBuffer(fragment(10));
    await sleep(150);
    hook.switchSpeed(2);
    el._ct = NEAR_END;
    await sleep(250);
    assert.equal(timescaleOf(real.appended[0]), TS * 2);
    assert.equal(real.appended.length, 2);
  });

  test('abort drops held appends and ends the update', async () => {
    const { sb, el, real } = setup();
    await append(sb, INIT);
    await append(sb, fragment(0));
    real._ranges = [[0, 10]];
    el._ct = 1; // playback, not a seek
    real.appended.length = 0;
    const seen = [];
    sb.addEventListener('abort', () => seen.push('abort'));
    sb.addEventListener('updateend', () => seen.push('updateend'));
    sb.appendBuffer(fragment(10));
    sb.abort();
    assert.deepEqual(seen, ['abort', 'updateend']);
    assert.equal(sb.updating, false);
    el._ct = NEAR_END;
    await sleep(250);
    assert.equal(real.appended.length, 0, 'never appended');
  });

  test('nothing buffered far enough: the next fragment gets the new speed', async () => {
    const { hook, el, sb, real } = setup();
    await append(sb, INIT);
    await append(sb, fragment(0));
    real._ranges = [[0, 2]];
    el.currentTime = 1;
    real.removed.length = 0;
    real.appended.length = 0;
    hook.switchSpeed(2);
    await flush();
    assert.deepEqual(real.removed, [], 'nothing to remove');
    assert.equal(el.playbackRate, 2);
    await append(sb, fragment(5));
    assert.equal(timescaleOf(real.appended[0]), TS * 2);
    assert.equal(real._ts, 5 - 5 / 2);
  });

  test('a seek back into the old speed is rebuilt at the new one', async () => {
    const { hook, el, sb, real } = setup();
    await append(sb, INIT);
    for (const t of [0, 5, 10, 15]) await append(sb, fragment(t));
    real._ranges = [[0, 20]];
    el.currentTime = 20 - LIVE_AHEAD_CAP_S / 2;
    hook.switchSpeed(2);
    await append(sb, fragment(20)); // the 2x part starts at 20
    real.removed.length = 0;
    el.currentTime = 30; // into the 2x part: nothing to rebuild
    await flush();
    assert.deepEqual(real.removed, []);
    el.currentTime = 2; // back into the 1x part
    await flush();
    assert.deepEqual(real.removed, [[0, Infinity]]);
    assert.equal(el._ct, 1, 'element time on the rebuilt 2x map');
  });

  test('a seek cut waits for the half-appended fragment to end (no hole)', async () => {
    const { hook, el, sb, real } = setup();
    await append(sb, INIT);
    for (const t of [0, 5]) await append(sb, fragment(t));
    real._ranges = [[0, 10]];
    el.currentTime = NEAR_END;
    hook.switchSpeed(2);
    // fragment at 10 arrives in two chunks: moof + mdat header (100 bytes
    // declared), then the rest of the mdat
    const moof = fragment(10).subarray(0, MOOF.length);
    const head = new Uint8Array(moof.length + 8 + 10);
    head.set(moof, 0);
    head.set([0, 0, 0, 108, 0x6d, 0x64, 0x61, 0x74], moof.length);
    await append(sb, head);
    real.removed.length = 0;
    el.currentTime = 3; // back into the 1x part, mid-fragment
    real._ranges = [[0, 2]]; // element 1.5 on the rebuilt 2x map: under the cap
    await flush();
    assert.deepEqual(real.removed, [], 'not in the middle of a fragment');
    await append(sb, new Uint8Array(90)); // the rest of the mdat
    assert.deepEqual(real.removed, [[0, Infinity]], 'cut right after it');
  });
  test('a duration set before the patch stays right across speed changes', async () => {
    const { hook, el, sb, real, ms } = setup({ presetDuration: 100 });
    await append(sb, INIT);
    await append(sb, fragment(0));
    real._ranges = [[0, 5]];
    el.currentTime = 5 - LIVE_AHEAD_CAP_S / 2;
    hook.switchSpeed(2);
    await append(sb, fragment(5)); // 2x from 5
    await flush();
    assert.equal(ms._d, 5 + 95 / 2, 'element duration on the new map');
    assert.equal(ms.duration, 100, 'content duration unchanged');
  });

  test('revoked blob URLs are forgotten', () => {
    const { win } = setup();
    const ms = new win.MediaSource();
    const url = win.URL.createObjectURL(ms);
    win.URL.revokeObjectURL(url);
    const el = win.document.createElement('video');
    el.src = url; // no session lookup for a revoked URL: nothing to attach
    assert.equal(el.src, url);
  });
});
