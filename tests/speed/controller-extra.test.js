import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeedController } from '../../src/speed/controller.js';
import { installSpeedFeature } from '../../src/speed/index.js';

function fakePlayer(overrides = {}) {
  const calls = [];
  const player = {
    calls,
    getVideoData: () => ({ video_id: '123' }),
    getCurrentTime: () => 42,
    loadVideoById: (id, start) => calls.push(['loadVideoById', id, start]),
    setPlaybackQualityRange: (a, b) =>
      calls.push(['setPlaybackQualityRange', a, b]),
    ...overrides
  };
  return player;
}

// The controller reloads through win.setTimeout (coalesced reload): a manual
// timer queue lets each test decide when the pending reload fires.
function getMocks() {
  const timers = new Map();
  let next = 1;
  const win = {
    AudioDecoder: class {},
    setTimeout: (fn) => {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    }
  };
  const flush = () => {
    for (const [id, fn] of [...timers]) {
      timers.delete(id);
      fn();
    }
  };
  const config = { enablePlaybackSpeed: true, forceHighResVideo: false };
  const notify = () => {};
  return { win, config, notify, flush };
}

describe('controller extra', () => {
  test('getCurrentTime() that throws does not crash setSpeed', () => {
    const { win, config, notify, flush } = getMocks();
    const player = fakePlayer({
      getCurrentTime: () => {
        throw new Error('Cannot get time');
      }
    });
    const ctl = createSpeedController({
      win,
      notify,
      configRead: (k) => config[k],
      getPlayer: () => player
    });
    assert.doesNotThrow(() => ctl.setSpeed(1.5));
    assert.doesNotThrow(() => flush());
    assert.equal(ctl.getSpeed(), 1.5);
    assert.deepEqual(
      player.calls.filter((c) => c[0] === 'loadVideoById'),
      [['loadVideoById', '123', 0]]
    );
  });

  test('getVideoData() without video_id just does not reload', () => {
    const { win, config, notify, flush } = getMocks();
    const player = fakePlayer({
      getVideoData: () => ({}) // no video_id
    });
    const ctl = createSpeedController({
      win,
      notify,
      configRead: (k) => config[k],
      getPlayer: () => player
    });
    ctl.setSpeed(1.5);
    flush();
    assert.equal(ctl.getSpeed(), 1.5);
    assert.equal(
      player.calls.filter((c) => c[0] === 'loadVideoById').length,
      0
    );
  });

  test('cycle() repeatedly very fast', () => {
    const { win, config, notify, flush } = getMocks();
    const player = fakePlayer();
    const ctl = createSpeedController({
      win,
      notify,
      configRead: (k) => config[k],
      getPlayer: () => player
    });

    // Ten presses in a burst: back to 1x, where the burst started, so the
    // coalesced reload has nothing to do.
    for (let i = 0; i < 10; i++) {
      ctl.cycle();
    }
    flush();
    assert.equal(ctl.getSpeed(), 1);
    assert.equal(
      player.calls.filter((c) => c[0] === 'loadVideoById').length,
      0
    );
  });

  test('uninstall() twice does not throw', () => {
    // We need a proper DOM mock for index.js
    const handlers = {};
    const win = {
      AudioDecoder: class {},
      AudioContext: class {},
      MediaSource: function () {},
      URL: { createObjectURL: () => 'blob' },
      HTMLMediaElement: function () {},
      EventTarget: class {},
      document: {
        addEventListener: (evt, h) => {
          handlers[evt] = h;
        },
        removeEventListener: (evt, h) => {
          if (handlers[evt] === h) delete handlers[evt];
        }
      }
    };
    win.MediaSource.prototype.addSourceBuffer = () => {};
    win.HTMLMediaElement.prototype = {};
    const feature = installSpeedFeature(win, {
      notify: () => {},
      configRead: () => true,
      getPlayer: () => null
    });

    // uninstall once
    feature.uninstall();
    assert.equal(handlers['keydown'], undefined);

    // uninstall twice
    assert.doesNotThrow(() => {
      feature.uninstall();
    });
  });
});
