// Contract tests for AudioEngine. The core property: the audio scheduled to
// start at context time `when` must be the content the video shows at `when`
// (the samples encode their own content time, see audio-fakes.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../../src/speed/audio-engine.js';
import {
  makeWorld,
  ExactStretcher,
  chunks,
  aacCfg,
  opusCfg,
  audible,
  effEnd,
  K
} from './audio-fakes.js';

const LEAD = 0.4;
const CHUNK = 0.1;

function setup(opts = {}) {
  const world = makeWorld(opts);
  const video = new world.FakeVideo();
  const engine = new AudioEngine({
    win: world.win,
    speed: world.speed,
    leadS: LEAD,
    chunkS: CHUNK,
    onError: (e) => world.errors.push(e),
    ...(opts.realStretcher
      ? {}
      : { createStretcher: ({ channels }) => new ExactStretcher({ channels }) })
  });
  engine.attachVideo(video);
  return { world, video, engine };
}

// A/V sync over a window in which the video model did not change.
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

// No gaps, no overlaps between audible sources in a window.
function checkContinuity(world, from, to) {
  const srcs = audible(world)
    .filter((s) => s.when >= from && s.when < to)
    .sort((a, b) => a.when - b.when);
  for (let i = 1; i < srcs.length; i++) {
    const gap = srcs[i].when - effEnd(srcs[i - 1]);
    assert.ok(
      Math.abs(gap) <= 1 / srcs[i].rate + 1e-6,
      `gap/overlap of ${(gap * 1000).toFixed(2)} ms at ctx ${srcs[i].when.toFixed(3)}`
    );
  }
}

const covered = (world, from, to) =>
  audible(world)
    .map((s) => Math.max(0, Math.min(effEnd(s), to) - Math.max(s.when, from)))
    .reduce((a, b) => a + b, 0);

async function startPlaying(
  world,
  video,
  engine,
  { cfg = aacCfg, from = 0, to = 20, rate = 44100, frames = 1024 } = {}
) {
  engine.configure(cfg);
  engine.push(chunks(from, to, { rate, frames }));
  await world.advance(100);
  video.play(380);
  const moveAt = world.now + 0.38;
  return moveAt;
}

describe('steady playback', () => {
  test('audio plays the content the video shows, without gaps, with a steady lead', async () => {
    const { world, video, engine } = setup();
    const moveAt = await startPlaying(world, video, engine);
    const leads = [];
    await world.advance(6000, () => {
      if (world.now > moveAt + 0.3) {
        const ahead = Math.max(...audible(world).map(effEnd)) - world.now;
        leads.push(ahead);
      }
    });
    checkSync(world, moveAt + 0.15, world.now - 0.5);
    checkContinuity(world, moveAt + 0.15, world.now - 0.5);
    assert.ok(
      Math.min(...leads) >= LEAD - 0.06,
      `lead dropped to ${Math.min(...leads).toFixed(3)}`
    );
    assert.ok(
      Math.max(...leads) <= LEAD + CHUNK + 0.06,
      `lead grew to ${Math.max(...leads).toFixed(3)}`
    );
    assert.equal(world.errors.length, 0);
  });

  test('nothing sounds before the frames actually move (start latency)', async () => {
    const { world, video, engine } = setup();
    const moveAt = await startPlaying(world, video, engine);
    await world.advance(2000);
    for (const s of audible(world))
      assert.ok(
        s.when >= moveAt - 0.02,
        `audio at ${s.when.toFixed(3)} before video moves at ${moveAt.toFixed(3)}`
      );
  });

  test('data arriving little by little (as YouTube appends) keeps sync', async () => {
    const { world, video, engine } = setup();
    engine.configure(aacCfg);
    engine.push(chunks(0, 2));
    await world.advance(100);
    video.play(380);
    const moveAt = world.now + 0.38;
    for (let k = 1; k <= 8; k++) {
      // Each step must land on the fake clock before the next chunk is pushed,
      // in playback order.
      // eslint-disable-next-line no-await-in-loop
      await world.advance(1000);
      engine.push(chunks(2 * k, 2 * k + 2));
    }
    checkSync(world, moveAt + 0.15, world.now - 0.5);
    checkContinuity(world, moveAt + 0.15, world.now - 0.5);
  });

  test('a decoder that answers late and out of order does not break sync', async () => {
    const { world, video, engine } = setup({ decodeDelayMs: 40, shuffle: 60 });
    const moveAt = await startPlaying(world, video, engine);
    await world.advance(5000);
    checkSync(world, moveAt + 0.15, world.now - 0.5);
    checkContinuity(world, moveAt + 0.15, world.now - 0.5);
  });
});

describe('drift and discontinuities', () => {
  // Drift is corrected on the mean of ~1.5 s of readings, because the TV's
  // audio clock makes single readings saw-tooth by ±60 ms and reacting to them
  // produced audible cuts (see audio-engine.clock.test.js). Real clock drift is
  // ~0.01%: 0.5% is still 50 times that.
  test('soft drift (video 0.5% faster) stays within 60 ms', async () => {
    const { world, video, engine } = setup();
    const moveAt = await startPlaying(world, video, engine, { to: 30 });
    await world.advance(1000);
    const c = video.currentTime;
    video._c0 = c;
    video._moveAt = world.now;
    video.rateFactor = 1.005;
    const t = world.now;
    await world.advance(5000);
    checkSync(world, t + 0.6, world.now - 0.5, 0.06);
    assert.ok(
      covered(world, t + 0.6, world.now - 0.5) >= 0.9 * (world.now - 1.1 - t),
      'audio went missing'
    );
    assert.ok(moveAt < t);
  });

  test('a silent 1 s jump is followed, and the audio does not go mute', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine);
    await world.advance(2000);
    video.jump(1);
    const t = world.now;
    await world.advance(3000);
    checkSync(world, t + 0.2, world.now - 0.5);
    checkContinuity(world, t + 0.2, world.now - 0.5);
    assert.ok(
      covered(world, t + 0.3, world.now - 0.5) >= 0.95 * (world.now - 0.8 - t),
      'audio went mute after the resync'
    );
  });
});

describe('pause, resume, seek', () => {
  test('pause silences at once; resume continues from the paused content', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine);
    await world.advance(2000);
    const pausedAt = world.now;
    const pausedContent = video.currentTime;
    video.pause();
    await world.advance(2000);
    for (const s of audible(world))
      assert.ok(
        effEnd(s) <= pausedAt + 0.02,
        `sound until ${effEnd(s).toFixed(3)} after pause at ${pausedAt.toFixed(3)}`
      );
    video.play(380);
    const moveAt = world.now + 0.38;
    await world.advance(3000);
    const after = checkSync(world, moveAt + 0.15, world.now - 0.5);
    const first = audible(world)
      .filter((s) => s.when >= pausedAt + 1)
      .sort((a, b) => a.when - b.when)[0];
    assert.ok(
      Math.abs(first.content - pausedContent) <= 0.1,
      `resumed at content ${first.content.toFixed(3)}, paused at ${pausedContent.toFixed(3)}`
    );
    assert.ok(after.length > 0);
  });

  test('pause / resume / seek repeated keep sync every time', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine, { to: 20 });
    // pause/seek/play must be applied to the fake clock in order, one round
    // trip per target: each await below is a deliberate, sequential step.
    for (const target of [50, 10, 55]) {
      // eslint-disable-next-line no-await-in-loop
      await world.advance(1500);
      video.pause();
      // eslint-disable-next-line no-await-in-loop
      await world.advance(500);
      video.seek(target);
      if (target >= 50) engine.push(chunks(target, target + 8));
      // eslint-disable-next-line no-await-in-loop
      await world.advance(300);
      video.play(380);
      const moveAt = world.now + 0.38;
      // eslint-disable-next-line no-await-in-loop
      await world.advance(2500);
      checkSync(world, moveAt + 0.15, world.now - 0.5);
      checkContinuity(world, moveAt + 0.15, world.now - 0.5);
    }
  });

  test('seek while playing: nothing from before the target is heard after it', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine, { to: 20 });
    await world.advance(2000);
    const t = world.now;
    video.seek(50);
    engine.push(chunks(50, 60));
    await world.advance(3000);
    for (const s of audible(world).filter((s) => effEnd(s) > t + 0.02)) {
      assert.ok(
        s.when >= t,
        `audio scheduled before the seek still sounds until ${effEnd(s).toFixed(3)}`
      );
      assert.ok(
        s.content >= 50 - 0.03,
        `content ${s.content.toFixed(3)} heard after seeking to 50`
      );
    }
    checkSync(world, t + 0.4, world.now - 0.5);
  });
});

describe('data management', () => {
  test('discard(a, b) during playback: that content is never heard', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine, { to: 20 });
    await world.advance(1000);
    engine.discard(6, 8);
    await world.advance(6000);
    const heard = (lo, hi) =>
      audible(world).some((s) => s.content >= lo && s.content < hi);
    assert.ok(
      heard(3, 6) && heard(8.05, 10),
      'audio must be heard before and after the discarded range'
    );
    for (const s of audible(world)) {
      const lo = Math.min(s.content, s.contentEnd);
      const hi = Math.max(s.content, s.contentEnd);
      assert.ok(
        hi <= 6 + 0.01 || lo >= 8 - 0.01,
        `buffer with content [${lo.toFixed(2)}, ${hi.toFixed(2)}] after discard(6, 8)`
      );
    }
  });

  test('reset() then new data from the current position resumes in sync (changeType)', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine, { to: 20 });
    await world.advance(2000);
    engine.reset();
    engine.configure(opusCfg);
    const c = video.currentTime;
    engine.push(chunks(Math.floor(c), 30, { rate: 48000, frames: 960 }));
    const t = world.now;
    await world.advance(3000);
    checkSync(world, t + 0.3, world.now - 0.5);
  });

  test('memory: decoded audio does not pile up during a long playback', async () => {
    const { world, video, engine } = setup();
    engine.configure(aacCfg);
    engine.push(chunks(0, 120));
    await world.advance(100);
    video.play(380);
    await world.advance(40000); // 60 s of content at 1.5x
    const seconds = engine.pcm.reduce((a, p) => a + p.n / p.rate, 0);
    assert.ok(
      seconds <= 15,
      `${seconds.toFixed(1)} s of decoded audio kept in memory after 60 s of content`
    );
    checkSync(world, world.now - 3, world.now - 0.5);
  });

  test('seeking back far into the archive after a long playback still plays in sync', async () => {
    const { world, video, engine } = setup();
    engine.configure(aacCfg);
    engine.push(chunks(0, 120));
    await world.advance(100);
    video.play(380);
    await world.advance(20000);
    video.seek(5);
    const t = world.now;
    await world.advance(3000);
    checkSync(world, t + 0.4, world.now - 0.5);
  });

  test('pushing a long archive stays cheap (no quadratic bookkeeping)', async () => {
    const { engine } = setup();
    engine.configure(aacCfg);
    const t0 = performance.now();
    for (let s = 0; s < 1800; s += 10) engine.push(chunks(s, s + 10));
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `pushing 30 min of AAC took ${ms.toFixed(0)} ms`);
  });

  test('reset() silences what is already queued', async () => {
    const { world, video, engine } = setup();
    engine.configure(aacCfg);
    engine.push(chunks(0, 20));
    await world.advance(100);
    video.play(380);
    await world.advance(2000);
    const t = world.now;
    const before = world.sources.length;
    engine.reset();
    await world.advance(50);
    for (const s of world.sources.slice(0, before))
      assert.ok(
        effEnd(s) <= t + 0.02,
        `old audio sounds until ${effEnd(s).toFixed(3)} after reset at ${t.toFixed(3)}`
      );
  });

  test('configure(A) then configure(B) right away ends with a decoder for B only', async () => {
    const { world, engine } = setup();
    engine.configure(aacCfg);
    engine.configure(opusCfg);
    await world.advance(100);
    const live = world.decoders.filter((d) => d.state === 'configured');
    assert.equal(live.length, 1, `${live.length} decoders alive`);
    assert.equal(live[0]._cfg.codec, 'opus');
  });

  test('discard of content already queued: it is not heard', async () => {
    const { world, video, engine } = setup();
    engine.configure(aacCfg);
    engine.push(chunks(0, 20));
    await world.advance(100);
    video.play(380);
    await world.advance(2000);
    const c = video.currentTime;
    engine.discard(c + 0.2, c + 0.5); // inside the 0.4 s lead (0.6 s of content)
    await world.advance(2000);
    for (const s of audible(world)) {
      const lo = Math.min(s.content, s.contentEnd);
      const hi = Math.max(s.content, s.contentEnd);
      assert.ok(
        hi <= c + 0.2 + 0.01 ||
          lo >= c + 0.5 - 0.01 ||
          (s.node.stopTime !== null &&
            s.node.stopTime <=
              s.when + (c + 0.2 - s.content) / world.speed + 0.01),
        `buffer [${lo.toFixed(2)}, ${hi.toFixed(2)}] overlaps the discarded [${(c + 0.2).toFixed(2)}, ${(c + 0.5).toFixed(2)}]`
      );
    }
  });
});

describe('formats', () => {
  test('48 kHz Opus-like frames: sync, continuity and the right sample rate', async () => {
    const { world, video, engine } = setup();
    const moveAt = await startPlaying(world, video, engine, {
      cfg: opusCfg,
      rate: 48000,
      frames: 960
    });
    await world.advance(4000);
    const srcs = checkSync(world, moveAt + 0.15, world.now - 0.5);
    checkContinuity(world, moveAt + 0.15, world.now - 0.5);
    for (const s of srcs) {
      const slope = (s.ch0[s.length - 1] - s.ch0[0]) / K / (s.length - 1);
      assert.ok(
        Math.abs(slope - world.speed / s.rate) <= (0.01 * world.speed) / s.rate,
        `content advances ${slope} per sample at ${s.rate} Hz`
      );
    }
  });

  test('HE-AAC: the decoder outputs at twice the configured rate, the engine follows the data', async () => {
    const { world, video, engine } = setup({ decodedRate: 44100 });
    const cfg = { ...aacCfg, codec: 'mp4a.40.5', sampleRate: 22050 };
    const moveAt = await startPlaying(world, video, engine, {
      cfg,
      rate: 22050,
      frames: 1024
    });
    await world.advance(4000);
    const srcs = checkSync(world, moveAt + 0.15, world.now - 0.5);
    for (const s of srcs) {
      const slope = (s.ch0[s.length - 1] - s.ch0[0]) / K / (s.length - 1);
      assert.ok(
        Math.abs(slope - world.speed / s.rate) <= (0.01 * world.speed) / s.rate,
        `buffer rate ${s.rate} does not match its content`
      );
    }
  });

  test('stereo: both channels are carried, not duplicated', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine);
    await world.advance(3000);
    for (const s of audible(world)) {
      assert.ok(s.ch1, 'mono buffer for a stereo source');
      for (let j = 0; j < s.length; j += 97)
        assert.ok(
          Math.abs(s.ch1[j] + s.ch0[j]) < 1e-6,
          'channel 1 is not channel 1'
        );
    }
  });

  test('timestamps are handed to WebCodecs as integer microseconds', async () => {
    const { world, video, engine } = setup();
    engine.configure(aacCfg);
    const odd = chunks(0, 6).map((c, i) => ({
      ...c,
      pts: c.pts + (1 / 3e6) * (i % 3)
    }));
    engine.push(odd);
    await world.advance(100);
    video.play(380);
    await world.advance(2000);
    assert.equal(world.errors.length, 0, String(world.errors[0]));
    assert.ok(audible(world).length > 0);
  });
});

describe('errors, volume, lifecycle', () => {
  test('unsupported config reports NotSupportedError and push never throws', async () => {
    const { world, engine } = setup({ unsupported: true });
    engine.configure(aacCfg);
    engine.push(chunks(0, 1));
    await world.advance(100);
    engine.push(chunks(1, 2));
    assert.equal(world.errors.length, 1);
    assert.equal(world.errors[0].name, 'NotSupportedError');
  });

  test('a decoder error reaches onError once', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine);
    await world.advance(500);
    world.decoders.at(-1).fail();
    engine.push(chunks(20, 21));
    await world.advance(500);
    assert.equal(world.errors.length, 1);
  });

  test('setVolume drives the gain, muted means 0', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine);
    await world.advance(1500);
    engine.setVolume(0.5, false);
    const gains = new Set(audible(world).map((s) => s.node.connectedTo));
    assert.equal(gains.size, 1, 'all sources go through one gain node');
    const [gain] = gains;
    assert.equal(gain.gain.value, 0.5);
    engine.setVolume(0.5, true);
    assert.equal(gain.gain.value, 0);
  });

  test('same configure twice keeps the decoder, a different one replaces and closes it', () => {
    const { world, engine } = setup();
    engine.configure(aacCfg);
    return world.advance(50).then(async () => {
      engine.configure({
        ...aacCfg,
        description: new Uint8Array([0x12, 0x10])
      });
      await world.advance(50);
      assert.equal(world.decoders.length, 1);
      engine.configure(opusCfg);
      await world.advance(50);
      assert.equal(world.decoders.length, 2);
      assert.equal(world.decoders[0].state, 'closed');
    });
  });

  test('destroy stops everything and leaves nothing behind', async () => {
    const { world, video, engine } = setup();
    await startPlaying(world, video, engine);
    await world.advance(2000);
    engine.destroy();
    const t = world.now;
    const n = world.sources.length;
    for (const s of world.sources)
      assert.ok(effEnd(s) <= t + 0.001, 'a source keeps playing after destroy');
    assert.equal(world.intervals.size, 0, 'interval left running');
    assert.equal(video.listenerCount(), 0, 'listeners left on the video');
    assert.ok(world.decoders.every((d) => d.state === 'closed'));
    await world.advance(1000);
    assert.equal(world.sources.length, n);
  });
});

describe('the real stretcher', () => {
  test('with the default WSOLA the audio is continuous and roughly in sync', async () => {
    const { world, video, engine } = setup({ realStretcher: true });
    const moveAt = await startPlaying(world, video, engine);
    await world.advance(4000);
    checkSync(world, moveAt + 0.2, world.now - 0.5, 0.1);
    assert.ok(
      covered(world, moveAt + 0.2, world.now - 0.5) >=
        0.95 * (world.now - 0.7 - moveAt),
      'holes in the audio'
    );
  });
});

describe('code hygiene', () => {
  test('no stray thinking-aloud comments left in the engine', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../src/speed/audio-engine.js', import.meta.url),
      'utf8'
    );
    assert.ok(!/\bWait\b|\?\s*Wait|let me/i.test(src));
  });
});
