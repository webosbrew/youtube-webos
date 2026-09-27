// Contract tests for the speed controller (createSpeedController) and its
// wiring into mse-hook/index (installSpeedFeature).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeedController,
  SPEEDS,
  RELOAD_DELAY_MS
} from '../../src/speed/controller.js';
import { installSpeedFeature } from '../../src/speed/index.js';
import { installMseHook } from '../../src/speed/mse-hook.js';
import { AudioEngine } from '../../src/speed/audio-engine.js';
import { makeWorld } from './audio-fakes.js';
import { domWindow, fakePlayer } from './dom-fakes.js';

// --- fakes -------------------------------------------------------------------

function controllerWith({
  player = fakePlayer(),
  config = {},
  world = makeWorld(),
  win
} = {}) {
  const notes = [];
  const w = win || world.win;
  const ctl = createSpeedController({
    win: w,
    getPlayer: () => player,
    notify: (text) => notes.push(text),
    configRead: (k) =>
      k in config
        ? config[k]
        : { enablePlaybackSpeed: true, forceHighResVideo: false }[k]
  });
  return { ctl, player, notes, world };
}

const key = (type, code) => {
  const e = {
    type,
    keyCode: code,
    charCode: code,
    prevented: false,
    stopped: false
  };
  e.preventDefault = () => {
    e.prevented = true;
  };
  e.stopPropagation = () => {
    e.stopped = true;
  };
  return e;
};

// --- controller ----------------------------------------------------------------
// The reload is coalesced: it happens RELOAD_DELAY_MS after the last change (see
// controller.js; measured on the TV, a reload per press lost the position).
const settle = (world) => world.advance(RELOAD_DELAY_MS + 50);

describe('controller', () => {
  test('SPEEDS is the yellow-button cycle', () => {
    assert.deepEqual(SPEEDS, [1, 1.25, 1.5, 1.75, 2]);
  });

  test('cycle goes 1 → 1.25 → 1.5 → 1.75 → 2 → 1, reloading the video at the same position each time', async () => {
    const { ctl, player, notes, world } = controllerWith();
    assert.equal(ctl.getSpeed(), 1);
    const seen = [];
    // Each press must settle on the fake clock before the next one, to observe
    // one reload per press.
    for (let i = 0; i < 5; i++) {
      ctl.cycle();
      seen.push(ctl.getSpeed());
      // eslint-disable-next-line no-await-in-loop
      await settle(world);
    }
    assert.deepEqual(seen, [1.25, 1.5, 1.75, 2, 1]);
    const loads = player.calls.filter((c) => c[0] === 'loadVideoById');
    assert.equal(loads.length, 5);
    for (const l of loads)
      assert.deepEqual(l, ['loadVideoById', 'abc123', 123.4]);
    assert.ok(
      notes.some((t) => /speed/i.test(t) && t.includes('1.5')),
      `notifications: ${JSON.stringify(notes)}`
    );
  });

  test('setting the same speed again does nothing', async () => {
    const { ctl, player, world } = controllerWith();
    ctl.setSpeed(1.5);
    await settle(world);
    ctl.setSpeed(1.5);
    await settle(world);
    assert.equal(
      player.calls.filter((c) => c[0] === 'loadVideoById').length,
      1
    );
  });

  test('above 1.25x quality is capped at 1080p BEFORE the reload, and restored when going back', async () => {
    const { ctl, player, world } = controllerWith();
    ctl.setSpeed(1.5);
    await settle(world);
    const i = player.calls.findIndex((c) => c[0] === 'setPlaybackQualityRange');
    const j = player.calls.findIndex((c) => c[0] === 'loadVideoById');
    assert.deepEqual(player.calls[i], [
      'setPlaybackQualityRange',
      'hd1080',
      'hd1080'
    ]);
    assert.ok(i < j, 'cap must come before the reload');
    player.calls.length = 0;
    ctl.setSpeed(1);
    await settle(world);
    assert.deepEqual(
      player.calls.find((c) => c[0] === 'setPlaybackQualityRange'),
      ['setPlaybackQualityRange', 'auto', 'auto']
    );
  });

  test('restoring honours forceHighResVideo', async () => {
    const { ctl, player, world } = controllerWith({
      config: { forceHighResVideo: true }
    });
    ctl.setSpeed(2);
    await settle(world);
    player.calls.length = 0;
    ctl.setSpeed(1.25);
    await settle(world);
    assert.deepEqual(
      player.calls.find((c) => c[0] === 'setPlaybackQualityRange'),
      ['setPlaybackQualityRange', 'highres', 'highres']
    );
  });

  test('a burst of presses reloads once, at the position of the first press (seen on the TV)', async () => {
    let t = 84.9;
    const player = fakePlayer();
    player.getCurrentTime = () => t;
    const { ctl, world } = controllerWith({ player });
    ctl.cycle();
    t = 0; // the player reports 0 while it loads
    ctl.cycle();
    ctl.cycle();
    await settle(world);
    const loads = player.calls.filter((c) => c[0] === 'loadVideoById');
    assert.deepEqual(loads, [['loadVideoById', 'abc123', 84.9]]);
    assert.equal(ctl.getSpeed(), 1.75);
  });

  test('a burst that comes back to the starting speed does not reload at all', async () => {
    const { ctl, player, world } = controllerWith();
    ctl.setSpeed(1.5);
    ctl.setSpeed(1);
    await settle(world);
    assert.equal(
      player.calls.filter((c) => c[0] === 'loadVideoById').length,
      0
    );
  });

  test('YELLOW stops the other listeners of the same node (YouTube re-dispatches keys)', () => {
    const { ctl } = controllerWith();
    const e = key('keydown', 405);
    let immediate = false;
    e.stopImmediatePropagation = () => {
      immediate = true;
    };
    ctl.handleKey(e);
    assert.ok(immediate);
  });

  test('1.25x does not cap quality', () => {
    const { ctl, player } = controllerWith();
    ctl.setSpeed(1.25);
    assert.equal(
      player.calls.filter((c) => c[0] === 'setPlaybackQualityRange').length,
      0
    );
  });

  test('disabled in the settings: speed stays 1, the button only explains', () => {
    const { ctl, player, notes } = controllerWith({
      config: { enablePlaybackSpeed: false }
    });
    ctl.cycle();
    assert.equal(ctl.getSpeed(), 1);
    assert.equal(player.calls.length, 0);
    assert.ok(
      notes.length === 1 && /disabled/i.test(notes[0]),
      JSON.stringify(notes)
    );
  });

  test('a TV without AudioDecoder: speed stays 1, the button only explains', () => {
    const world = makeWorld();
    const win = { ...world.win };
    delete win.AudioDecoder;
    const { ctl, player, notes } = controllerWith({ win });
    assert.equal(ctl.isSupported(), false);
    ctl.cycle();
    assert.equal(ctl.getSpeed(), 1);
    assert.equal(player.calls.length, 0);
    assert.ok(
      notes.length === 1 && /not supported/i.test(notes[0]),
      JSON.stringify(notes)
    );
  });

  test('an engine/hook error falls back to 1x once, with a notice', async () => {
    const { ctl, player, notes, world } = controllerWith();
    ctl.setSpeed(1.5);
    await settle(world);
    player.calls.length = 0;
    notes.length = 0;
    ctl.onError(Object.assign(new Error('x'), { name: 'NotSupportedError' }));
    await settle(world);
    assert.equal(ctl.getSpeed(), 1);
    assert.equal(
      player.calls.filter((c) => c[0] === 'loadVideoById').length,
      1
    );
    assert.ok(
      notes.some((t) => /not available/i.test(t)),
      JSON.stringify(notes)
    );
    ctl.onError(new Error('again'));
    await settle(world);
    assert.equal(
      player.calls.filter((c) => c[0] === 'loadVideoById').length,
      1,
      'no second reload at 1x'
    );
  });

  test('no player yet: the speed is kept for the next video, nothing throws', () => {
    const notes = [];
    const ctl = createSpeedController({
      win: makeWorld().win,
      getPlayer: () => null,
      notify: (t) => notes.push(t),
      configRead: (k) =>
        ({ enablePlaybackSpeed: true, forceHighResVideo: false })[k]
    });
    ctl.setSpeed(1.5);
    assert.equal(ctl.getSpeed(), 1.5);
  });

  test('onRateRequest from the page is ignored (YouTube resets its own rate to 1 on every load)', () => {
    const { ctl, player } = controllerWith();
    ctl.setSpeed(1.5);
    player.calls.length = 0;
    ctl.onRateRequest(1);
    ctl.onRateRequest(2);
    assert.equal(ctl.getSpeed(), 1.5);
    assert.equal(player.calls.length, 0);
  });

  test('createAudioSink builds an AudioEngine bound to the element, mirroring its volume', () => {
    const world = makeWorld();
    const { ctl } = controllerWith({ world });
    const el = new world.FakeVideo();
    el.volume = 0.3;
    el.muted = false;
    const sink = ctl.createAudioSink({ speed: 1.5, element: el });
    assert.ok(sink instanceof AudioEngine);
    assert.equal(sink.video, el);
    const gain = sink.gain.gain;
    assert.equal(gain.value, 0.3);
    el.muted = true;
    el.dispatchEvent(new world.win.Event('volumechange'));
    assert.equal(gain.value, 0);
    const sink2 = ctl.createAudioSink({ speed: 1.5, element: el });
    assert.notEqual(sink2, sink);
    assert.ok(
      !world.intervals.has(sink.tickInterval),
      'the previous engine is destroyed'
    );
    el.muted = false;
    el.volume = 0.8;
    el.dispatchEvent(new world.win.Event('volumechange'));
    assert.equal(sink2.gain.gain.value, 0.8);
    assert.equal(gain.value, 0, 'the old engine no longer follows the element');
  });

  test('handleKey: yellow keydown cycles; keypress/keyup of yellow are swallowed; other keys untouched', () => {
    const { ctl } = controllerWith();
    for (const code of [405, 170]) {
      const down = key('keydown', code);
      assert.equal(ctl.handleKey(down), true);
      assert.ok(down.prevented && down.stopped);
    }
    assert.equal(ctl.getSpeed(), 1.5);
    for (const type of ['keypress', 'keyup']) {
      const e = key(type, 405);
      assert.equal(ctl.handleKey(e), true);
      assert.ok(e.prevented);
    }
    assert.equal(ctl.getSpeed(), 1.5);
    const other = key('keydown', 13);
    assert.equal(ctl.handleKey(other), false);
    assert.ok(!other.prevented);
  });

  test('yellow reported only through charCode (as YTAF ui.js reads colour keys) still cycles', () => {
    const { ctl } = controllerWith();
    const e = {
      type: 'keydown',
      keyCode: 0,
      charCode: 405,
      preventDefault() {},
      stopPropagation() {}
    };
    assert.equal(ctl.handleKey(e), true);
    assert.equal(ctl.getSpeed(), 1.25);
  });

  test('turning the option off makes the next videos play at 1x', () => {
    const config = { enablePlaybackSpeed: true, forceHighResVideo: false };
    const { ctl } = controllerWith({ config });
    ctl.setSpeed(1.5);
    config.enablePlaybackSpeed = false;
    assert.equal(ctl.getSpeed(), 1);
  });

  test('a sink created without an element is still destroyed when the next one comes', () => {
    const world = makeWorld();
    const { ctl } = controllerWith({ world });
    const first = ctl.createAudioSink({ speed: 1.5, element: null });
    ctl.createAudioSink({ speed: 1.5, element: new world.FakeVideo() });
    assert.ok(
      !world.intervals.has(first.tickInterval),
      'the element-less engine keeps ticking'
    );
  });

  test('a player whose getCurrentTime throws: setSpeed does not throw and reloads from the start', () => {
    const player = {
      calls: [],
      getVideoData: () => ({ video_id: 'v' }),
      getCurrentTime() {
        throw new Error('boom');
      },
      loadVideoById(...a) {
        this.calls.push(['load', ...a]);
      },
      setPlaybackQualityRange() {}
    };
    const { ctl } = controllerWith({ player });
    assert.doesNotThrow(() => ctl.setSpeed(1.5));
    assert.equal(ctl.getSpeed(), 1.5);
  });
});

// --- wiring ------------------------------------------------------------------

describe('wiring', () => {
  test('mse-hook hands the bound element and the speed to createAudioSink', () => {
    const world = makeWorld();
    const win = domWindow(world);
    const got = [];
    installMseHook(win, {
      getSpeed: () => 1.5,
      createAudioSink: (o) => {
        got.push(o);
        return { configure() {}, push() {}, discard() {}, reset() {} };
      },
      onRateRequest() {},
      onError() {}
    });
    const ms = new win.MediaSource();
    const el = win.document.createElement('video');
    el.src = win.URL.createObjectURL(ms);
    ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    assert.equal(got.length, 1);
    assert.equal(got[0].element, el);
    assert.equal(got[0].speed, 1.5);
  });

  test('installSpeedFeature does nothing on a TV without AudioDecoder', () => {
    const world = makeWorld();
    const win = domWindow(world, { withAudio: false });
    const before = win.MediaSource.prototype.addSourceBuffer;
    const r = installSpeedFeature(win, {
      notify() {},
      configRead: () => true,
      getPlayer: () => null
    });
    assert.equal(r, null);
    assert.equal(win.MediaSource.prototype.addSourceBuffer, before);
    assert.equal(win.document.listenerCount(), 0);
  });

  test('installSpeedFeature hooks MSE and the yellow button; uninstall undoes both', () => {
    const world = makeWorld();
    const win = domWindow(world);
    const before = win.MediaSource.prototype.addSourceBuffer;
    const notes = [];
    const player = fakePlayer();
    const r = installSpeedFeature(win, {
      notify: (t) => notes.push(t),
      configRead: (k) =>
        ({ enablePlaybackSpeed: true, forceHighResVideo: false })[k],
      getPlayer: () => player
    });
    assert.ok(r && r.controller);
    assert.notEqual(win.MediaSource.prototype.addSourceBuffer, before);
    win.document.dispatchEvent(
      Object.assign(new win.Event('keydown'), {
        keyCode: 405,
        charCode: 405,
        preventDefault() {},
        stopPropagation() {}
      })
    );
    assert.equal(r.controller.getSpeed(), 1.25);
    // a MediaSource created now gets the new speed: the audio SourceBuffer is a fake
    const ms = new win.MediaSource();
    const el = win.document.createElement('video');
    el.src = win.URL.createObjectURL(ms);
    ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    assert.equal(
      ms._sbs.length,
      1,
      'audio went to the engine, not to the hardware'
    );
    r.uninstall();
    assert.equal(win.MediaSource.prototype.addSourceBuffer, before);
    assert.equal(win.document.listenerCount(), 0);
  });
});
