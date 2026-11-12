import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeWindow } from './fakes.js';
import { attachElementShim } from '../../src/speed/element-shim.js';
import { SpeedTimeMap } from '../../src/speed/timemap.js';

describe('element-shim', () => {
  let win, el, timeMap, rateRequests, uninstalls;

  beforeEach(() => {
    win = makeFakeWindow();
    el = win.document.createElement('video');
    timeMap = new SpeedTimeMap(1.5);
    rateRequests = [];
    uninstalls = [];
  });

  afterEach(() => {
    uninstalls.forEach((u) => {
      u();
    });
  });

  test('at S = 1 the element has no own properties', () => {
    timeMap = new SpeedTimeMap(1.0);
    const shim = attachElementShim(el, timeMap, {
      onRateRequest: (r) => rateRequests.push(r)
    });
    uninstalls.push(shim.detach);

    const ownProps = Object.getOwnPropertyNames(el).filter((p) =>
      [
        'currentTime',
        'duration',
        'buffered',
        'seekable',
        'playbackRate',
        'src'
      ].includes(p)
    );
    assert.deepEqual(ownProps, []);
  });

  test('at S = 1.5, currentTime/duration/buffered/playbackRate are mapped', () => {
    const shim = attachElementShim(el, timeMap, {
      onRateRequest: (r) => rateRequests.push(r)
    });
    uninstalls.push(shim.detach);

    // underlying currentTime 4 -> el.currentTime 6; el.currentTime = 9 -> underlying 6.
    el._currentTime = 4;
    assert.equal(el.currentTime, 6);

    el.currentTime = 9;
    assert.equal(el._currentTime, 6);

    // duration and buffered are mapped too
    el._duration = 10;
    assert.equal(el.duration, 15);

    el._buffered = { length: 1, start: () => 2, end: () => 4 };
    assert.equal(el.buffered.length, 1);
    assert.equal(el.buffered.start(0), 3);
    assert.equal(el.buffered.end(0), 6);

    // el.playbackRate reads back 1.5
    assert.equal(el.playbackRate, 1.5);

    // el.playbackRate = 2 calls onRateRequest(2) and leaves the underlying alone
    el._playbackRate = 1; // underlying should stay untouched
    el.playbackRate = 2;
    assert.equal(el._playbackRate, 1);
    assert.equal(rateRequests.length, 1);
    assert.equal(rateRequests[0], 2);
  });
});
