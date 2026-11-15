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
