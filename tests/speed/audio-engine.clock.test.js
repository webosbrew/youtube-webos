// Regression test for the TV's stepping audio clock: on hardware, currentTime
// advances in coarse steps rather than continuously, which made a drift reading
// saw-tooth by up to ±60 ms even when audio and video were aligned. Reacting to
// every swing above 40 ms stopped all queued audio and restarted it, producing
// a micro-interruption roughly every tenth of a second (25 hard resyncs measured
// in 5 s on the device). The fix is described in audio-engine.js; this test
// reproduces the clock shape and checks no buffer is cut short by a resync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../../src/speed/audio-engine.js';
import {
  makeWorld,
  ExactStretcher,
  chunks,
  aacCfg,
  audible,
  effEnd
} from './audio-fakes.js';

test('a stepping audio clock (like the TV) does not cause resyncs: audio stays continuous', async () => {
  const world = makeWorld({ ctxQuantumMs: 60 });
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
  engine.configure(aacCfg);
  engine.push(chunks(0, 30));
  await world.advance(100);
  video.play(380);
  await world.advance(1500);
  const from = world.now;
  await world.advance(6000);
  const inWindow = world.sources.filter(
    (s) => s.when >= from && s.when < world.now - 0.5
  );
  const cut = inWindow.filter(
    (s) => s.node.stopTime !== null && s.node.stopTime < s.when + s.dur - 1e-6
  );
  assert.equal(
    cut.length,
    0,
    `${cut.length} buffers cut short by resyncs in 6 s`
  );
  const srcs = audible(world)
    .filter((s) => s.when >= from && s.when < world.now - 0.5)
    .sort((a, b) => a.when - b.when);
  for (let i = 1; i < srcs.length; i++) {
    const gap = srcs[i].when - effEnd(srcs[i - 1]);
    assert.ok(
      Math.abs(gap) <= 1 / srcs[i].rate + 1e-6,
      `gap/overlap of ${(gap * 1000).toFixed(1)} ms`
    );
  }
  for (const s of srcs) {
    const e = video.contentAt(s.when);
    assert.ok(
      Math.abs(s.content - e) <= 0.1,
      `audio ${s.content.toFixed(3)} vs video ${e.toFixed(3)}`
    );
  }
});
