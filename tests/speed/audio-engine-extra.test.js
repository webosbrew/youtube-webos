import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../../src/speed/audio-engine.js';
import {
  makeWorld,
  ExactStretcher,
  chunks,
  aacCfg,
  audible
} from './audio-fakes.js';

function checkSync(world, from, to, tol = 0.03) {
  const srcs = audible(world).filter((s) => s.when >= from && s.when < to);
  assert.ok(
    srcs.length > 0,
    `no audible audio scheduled in [${from.toFixed(2)}, ${to.toFixed(2)})`
  );
  for (const s of srcs) {
    const expected = world.video.contentAt(s.when);
    assert.ok(
      Math.abs(s.content - expected) <= tol,
      `at ctx ${s.when.toFixed(3)} audio plays content ${s.content.toFixed(3)} but video shows ${expected.toFixed(3)}`
    );
  }
  return srcs;
}

function setup(opts = {}) {
  const world = makeWorld(opts);
  const video = new world.FakeVideo();
  const engine = new AudioEngine({
    win: world.win,
    speed: world.speed,
    leadS: 0.4,
    chunkS: 0.1,
    onError: (e) => world.errors.push(e),
    createStretcher: ({ channels }) => new ExactStretcher({ channels })
  });
  engine.attachVideo(video);
  return { world, video, engine };
}

test('extra: reset() called mid-queue discards pending frames but does not break sync', async () => {
  const { world, video, engine } = setup();
  engine.configure(aacCfg);
  engine.push(chunks(0, 10)); // push 10s of data
  await world.advance(100);
  video.play();

  await world.advance(2000);
  // mid playback reset
  engine.reset();

  // push completely new data from the current point
  const currentContent = video.contentAt(world.now);
  engine.push(chunks(currentContent, currentContent + 10));

  await world.advance(2000);
  checkSync(world, 0.4, world.now - 0.5);
});

test('extra: configure() with different rate mid-playback closes old decoder and re-syncs', async () => {
  const { world, video, engine } = setup();
  engine.configure(aacCfg);
  engine.push(chunks(0, 2));
  await world.advance(100);
  video.play();

  await world.advance(1000);
  const newCfg = { ...aacCfg, sampleRate: 48000 };
  engine.configure(newCfg);

  const currentContent = video.contentAt(world.now);
  engine.push(chunks(currentContent, currentContent + 2, { rate: 48000 }));

  await world.advance(1000);
  assert.equal(world.errors.length, 0);
  checkSync(world, 1.5, world.now - 0.2); // Check sync after format change
});

test('extra: destroy() during active decode leaves nothing behind', async () => {
  const { world, video, engine } = setup();
  engine.configure(aacCfg);
  engine.push(chunks(0, 2));
  await world.advance(100);
  video.play();

  await world.advance(100);
  engine.destroy(); // destroy while actively pushing to decoder

  await world.advance(500);
  assert.equal(world.timeouts.length, 0, 'no leftover intervals/timeouts');
  assert.equal(world.errors.length, 0);
});

test('extra: a new audio offset is applied at once by resync()', async () => {
  const world = makeWorld();
  const video = new world.FakeVideo();
  let offsetMs = 0;
  const engine = new AudioEngine({
    win: world.win,
    speed: world.speed,
    leadS: 0.4,
    chunkS: 0.1,
    getExtraDelayMs: () => offsetMs,
    onError: (e) => world.errors.push(e),
    createStretcher: ({ channels }) => new ExactStretcher({ channels })
  });
  engine.attachVideo(video);
  engine.configure(aacCfg);
  engine.push(chunks(0, 10));
  await world.advance(100);
  video.play();
  await world.advance(2000);
  const err = (from, to) => {
    const srcs = audible(world).filter((s) => s.when >= from && s.when < to);
    assert.ok(srcs.length > 0);
    return (
      srcs.reduce((sum, s) => sum + s.content - video.contentAt(s.when), 0) /
      srcs.length
    );
  };
  const before = err(world.now - 1, world.now);
  // 30 ms later: under the drift correction's 45 ms threshold, so without
  // resync() it would never be heard.
  offsetMs = 30;
  engine.resync();
  const t = world.now;
  await world.advance(1500);
  const after = err(t + 0.3, t + 1.2);
  assert.ok(
    // In content time: 30 ms of real time at the world's speed.
    Math.abs(after - before + 0.03 * world.speed) <= 0.006,
    `moved by ${((after - before) * 1000).toFixed(1)} ms, expected ${-30 * world.speed}`
  );
});
