// Regression test: WSOLA pulled little by little (as the audio engine does), not
// in one go at the end like tests/speed/wsola.test.js. This caught a bug where
// the output buffer was shifted without clearing its tail, so later frames were
// overlap-added onto stale samples and the signal grew without bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsolaStretcher } from '../../src/speed/wsola.js';

function run({ S, searchStep, corrStep, gen }) {
  const sr = 44100;
  const w = new WsolaStretcher({
    sampleRate: sr,
    channels: 1,
    searchStep,
    corrStep
  });
  w.setSpeed(S);
  const out = [];
  for (let i = 0; i < sr * 5; i += 1024) {
    const a = new Float32Array(1024);
    for (let j = 0; j < 1024; j++) a[j] = gen((i + j) / sr);
    w.push([a]);
    for (const v of w.pull(w.available())[0]) out.push(v);
  }
  return { out, sr };
}

for (const [ss, cs] of [
  [1, 1],
  [2, 2]
]) {
  test(`streaming pulls keep the content mapping (ramp, steps ${ss}/${cs})`, () => {
    const S = 1.5;
    const { out, sr } = run({
      S,
      searchStep: ss,
      corrStep: cs,
      gen: (t) => 0.01 * t
    });
    for (const t of [0.5, 1, 2, 3]) {
      const content = out[Math.round(t * sr)] / 0.01;
      assert.ok(
        Math.abs(content - t * S) <= 0.08,
        `output at ${t}s carries content ${content.toFixed(3)}, expected ${(t * S).toFixed(3)}`
      );
    }
  });

  test(`streaming pulls keep the loudness of a sine (steps ${ss}/${cs})`, () => {
    const { out } = run({
      S: 2,
      searchStep: ss,
      corrStep: cs,
      gen: (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t)
    });
    const mid = out.slice(
      Math.floor(out.length * 0.3),
      Math.floor(out.length * 0.7)
    );
    const rms = Math.sqrt(mid.reduce((a, v) => a + v * v, 0) / mid.length);
    assert.ok(
      Math.abs(rms - 0.5 / Math.SQRT2) / (0.5 / Math.SQRT2) <= 0.1,
      `rms ${rms.toFixed(3)}`
    );
  });
}
