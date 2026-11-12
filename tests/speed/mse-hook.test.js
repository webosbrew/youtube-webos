import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFakeWindow } from './fakes.js';
import { installMseHook } from '../../src/speed/mse-hook.js';
import { parseInitInfo, demuxFragments } from '../../src/speed/isobmff.js';

const dir = new URL('./fixtures/', import.meta.url);
const load = (name) => new Uint8Array(readFileSync(new URL(name, dir)));
const yt136 = load('yt_136.bin'); // video mp4
const yt140 = load('yt_140.bin'); // audio mp4
const yt247 = load('yt_247.bin'); // video webm
const yt251 = load('yt_251.bin'); // audio webm

function lcg(seed) {
  return function () {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function appendInChunks(buffer, data, rng) {
  let pos = 0;
  while (pos < data.length) {
    const chunkLen = Math.floor(rng() * 4096) + 1;
    const end = Math.min(pos + chunkLen, data.length);
    buffer.appendBuffer(data.slice(pos, end));
    pos = end;
    if (buffer.updating) {
      // Each chunk must finish updating before the next one is appended, as
      // the browser requires.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const handler = () => {
          buffer.removeEventListener('updateend', handler);
          resolve();
        };
        buffer.addEventListener('updateend', handler);
      });
    }
  }
}

function concat(arrays) {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const res = new Uint8Array(total);
  let offset = 0;
  for (let a of arrays) {
    res.set(a, offset);
    offset += a.length;
  }
  return res;
}

describe('mse-hook', () => {
  let win, sink, getSpeed, uninstalls, rateRequests, errors;

  beforeEach(() => {
    win = makeFakeWindow();
    sink = {
      configures: [],
      pushCalls: [],
      discards: [],
      resetCalls: 0,
      configureFn(c) {
        this.configures.push(c);
      },
      pushFn(s) {
        this.pushCalls.push(s);
      },
      discardFn(s, e) {
        this.discards.push({ start: s, end: e });
      },
      resetFn() {
        this.resetCalls++;
      }
    };
    sink.configureFn = sink.configureFn.bind(sink);
    sink.pushFn = sink.pushFn.bind(sink);
    sink.discardFn = sink.discardFn.bind(sink);
    sink.resetFn = sink.resetFn.bind(sink);
    sink.configure = sink.configureFn;
    sink.push = sink.pushFn;
    sink.discard = sink.discardFn;
    sink.reset = sink.resetFn;

    let speed = 1.5;
    getSpeed = () => speed;
    uninstalls = [];
    rateRequests = [];
    errors = [];

    // capture original addSourceBuffer
    win.MediaSource._originalAddSourceBuffer =
      win.MediaSource.prototype.addSourceBuffer;

    const hook = installMseHook(win, {
      getSpeed: () => getSpeed(),
      createAudioSink: () => sink,
      onRateRequest: (r) => rateRequests.push(r),
      onError: (e) => errors.push(e)
    });
    if (hook && hook.uninstall) {
      uninstalls.push(hook.uninstall);
    }
  });

  afterEach(() => {
    uninstalls.forEach((u) => {
      u();
    });
  });

  test('S = 1: addSourceBuffer returns the original SourceBuffer; yt_136.bin bytes arrive identical', () => {
    getSpeed = () => 1.0;
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('video/mp4; codecs="avc1"');

    assert.equal(Object.getPrototypeOf(sb), win.FakeSourceBuffer.prototype);

    sb.appendBuffer(yt136);
    assert.equal(sb.appendedBytes.length, 1);
    assert.deepEqual(sb.appendedBytes[0], yt136);
  });

  test('S = 1.5, video MP4: yt_136.bin appended in random chunks, timescale 18432', async () => {
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('video/mp4; codecs="avc1"');
    const rng = lcg(42);

    await appendInChunks(sb, yt136, rng);

    const underlying = ms.sourceBuffers.item(0);
    const output = concat(underlying.appendedBytes);
    assert.equal(output.length, yt136.length);

    let diffs = [];
    for (let i = 0; i < yt136.length; i++) {
      if (yt136[i] !== output[i]) diffs.push(i);
    }
    assert.ok(diffs.length > 0 && diffs.length <= 4);

    const dv = new DataView(
      output.buffer,
      output.byteOffset,
      output.byteLength
    );
    const ts = dv.getUint32(diffs[0] - 2);
    assert.equal(ts, 18432); // 12288 * 1.5
  });

  test('S = 1.5, video WebM: yt_247.bin -> TimecodeScale 666667', () => {
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('video/webm; codecs="vp9"');

    sb.appendBuffer(yt247);
    const underlying = ms.sourceBuffers.item(0);
    const output = underlying.appendedBytes[0];

    let diffs = [];
    for (let i = 0; i < yt247.length; i++) {
      if (yt247[i] !== output[i]) diffs.push(i);
    }
    assert.equal(diffs.length, 3);

    let val = 0;
    for (let i = 0; i < diffs.length; i++) {
      val = (val << 8) | output[diffs[i]];
    }
    assert.equal(val, 666667);
  });

  test('video SourceBuffer timings', () => {
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('video/mp4; codecs="avc1"');
    const underlying = ms.sourceBuffers.item(0);

    sb.timestampOffset = 10;
    assert.equal(underlying._timestampOffset, 10 / 1.5);
    assert.equal(sb.timestampOffset, 10);

    sb.remove(3, 6);
    assert.equal(underlying.removeCalls.length, 1);
    assert.equal(underlying.removeCalls[0].start, 2);
    assert.equal(underlying.removeCalls[0].end, 4);

    underlying._buffered = { start: () => 0, end: () => 4, length: 1 };
    assert.equal(sb.buffered.start(0), 0);
    assert.equal(sb.buffered.end(0), 6);

    sb.appendWindowEnd = Infinity;
    assert.equal(underlying._appendWindowEnd, Infinity);
  });

  test('Audio MP4 at S = 1.5', async () => {
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');

    assert.equal(ms.sourceBuffers.length, 1);
    assert.notEqual(
      Object.getPrototypeOf(ms.sourceBuffers.item(0)),
      win.FakeSourceBuffer.prototype
    );

    const rng = lcg(42);
    let startCount = 0,
      updateCount = 0,
      endCount = 0;

    sb.addEventListener('updatestart', () => startCount++);
    sb.addEventListener('update', () => updateCount++);
    sb.addEventListener('updateend', () => endCount++);

    await appendInChunks(sb, yt140, rng);

    assert.equal(sink.configures.length, 1);
    assert.equal(sink.configures[0].codec, 'mp4a.40.2');

    const parsed = parseInitInfo(yt140);
    const expected = demuxFragments(yt140, parsed).samples;

    let pushedSamples = [];
    for (let c of sink.pushCalls) pushedSamples.push(...c);

    assert.equal(pushedSamples.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
      assert.equal(pushedSamples[i].pts, expected[i].pts);
    }

    assert.ok(startCount > 0);
    assert.equal(startCount, updateCount);
    assert.equal(startCount, endCount);

    sb.appendBuffer(new Uint8Array(10));
    assert.throws(
      () => sb.appendBuffer(new Uint8Array(10)),
      /InvalidStateError/
    );

    await new Promise((r) => {
      const handler = () => {
        sb.removeEventListener('updateend', handler);
        r();
      };
      sb.addEventListener('updateend', handler);
    });

    const b = sb.buffered;
    assert.equal(b.length, 1);
    assert.equal(b.start(0), expected[0].pts);
    assert.equal(
      b.end(0),
      expected[expected.length - 1].pts + expected[expected.length - 1].duration
    );
  });

  test('Audio WebM at S = 1.5', async () => {
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/webm; codecs="opus"');

    sb.timestampOffset = 5;
    sb.appendBuffer(yt251);
    await new Promise((r) => {
      const h = () => {
        sb.removeEventListener('updateend', h);
        r();
      };
      sb.addEventListener('updateend', h);
    });

    assert.equal(sink.configures.length, 1);
    assert.equal(sink.configures[0].codec, 'opus');
  });

  test('mediaSource.duration = 30', () => {
    const ms = new win.MediaSource();
    ms.addSourceBuffer('video/mp4; codecs="avc1"');
    ms.duration = 30;
    assert.equal(ms.duration, 30);
    assert.equal(ms._duration, 20);
  });

  test('a malformed init reports an error and still forwards the bytes', () => {
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('video/mp4; codecs="avc1"');
    const junk = new Uint8Array(50001);
    junk.set([
      0, 0, 0, 1, 102, 116, 121, 112, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0
    ]);
    sb.appendBuffer(junk);
    assert.equal(errors.length, 1);
    const underlying = ms.sourceBuffers.item(0);
    assert.deepEqual(underlying.appendedBytes[0], junk);
  });

  test('uninstall() restores the original addSourceBuffer', () => {
    assert.notEqual(
      win.MediaSource.prototype.addSourceBuffer,
      win.MediaSource._originalAddSourceBuffer
    );
    uninstalls[0]();
    uninstalls = [];
    assert.equal(
      win.MediaSource.prototype.addSourceBuffer,
      win.MediaSource._originalAddSourceBuffer
    );
  });
});
