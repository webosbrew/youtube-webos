// Regression: after slowing down or speeding up, going
// back to Normal played two audio tracks on top of each other. At 1x the audio
// SourceBuffer is the real one again, but nothing stopped the Web Audio engine
// of the previous speed: YouTube reuses the same <video>, so the old engine kept
// following it and playing its buffered PCM over the native audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSpeedFeature } from '../../src/speed/index.js';
import { makeWorld } from './audio-fakes.js';
import { domWindow, fakePlayer } from './dom-fakes.js';

function feature() {
  const world = makeWorld();
  const win = domWindow(world);
  const player = fakePlayer();
  const r = installSpeedFeature(win, {
    notify() {},
    configRead: (k) =>
      ({ enablePlaybackSpeed: true, forceHighResVideo: false })[k],
    getPlayer: () => player
  });
  const el = win.document.createElement('video');
  function load() {
    const ms = new win.MediaSource();
    el.src = win.URL.createObjectURL(ms);
    ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    return ms;
  }
  return { r, load };
}

for (const speed of [1.5, 0.75]) {
  test(`back to 1x after ${speed}x: the previous Web Audio engine is stopped`, () => {
    const { r, load } = feature();
    r.controller.setSpeed(speed);
    load();
    const engine = r.controller.activeEngine();
    assert.ok(engine, 'an engine plays at ' + speed + 'x');
    r.controller.setSpeed(1);
    const ms = load(); // the reload, on the same <video>
    assert.equal(ms._sbs.length, 2, 'at 1x the audio goes to the hardware');
    assert.equal(
      engine.destroyed,
      true,
      'old engine still alive: two audio tracks'
    );
    assert.equal(engine.ctx.state, 'closed');
    assert.equal(r.controller.activeEngine(), null);
    r.uninstall();
  });
}

test('turning the option off: the next video at 1x stops the engine too', () => {
  const world = makeWorld();
  const win = domWindow(world);
  const config = { enablePlaybackSpeed: true, forceHighResVideo: false };
  const r = installSpeedFeature(win, {
    notify() {},
    configRead: (k) => config[k],
    getPlayer: () => fakePlayer()
  });
  const el = win.document.createElement('video');
  const load = () => {
    const ms = new win.MediaSource();
    el.src = win.URL.createObjectURL(ms);
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  };
  r.controller.setSpeed(2);
  load();
  const engine = r.controller.activeEngine();
  config.enablePlaybackSpeed = false;
  load();
  assert.equal(engine.destroyed, true);
  r.uninstall();
});
