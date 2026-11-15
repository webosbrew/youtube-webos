import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WsolaStretcher } from '../../src/speed/wsola.js';

function createSine(freq, sampleRate, durationSec, channels = 1) {
  const len = Math.floor(sampleRate * durationSec);
  const bufs = Array.from({ length: channels }, () => new Float32Array(len));
  for (let i = 0; i < len; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    for (let c = 0; c < channels; c++) bufs[c][i] = v;
  }
  return bufs;
}

function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function estimateFreqZeroCrossing(buf, sampleRate) {
  let crossings = 0;
  let firstCrossing = -1;
  let lastCrossing = -1;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) {
      if (firstCrossing === -1) firstCrossing = i;
      lastCrossing = i;
      crossings++;
    }
  }
  if (crossings < 2) return 0;
  const duration = (lastCrossing - firstCrossing) / sampleRate;
  return (crossings - 1) / duration;
}

describe('wsola.js', () => {
  test('speed 1 -> exact bypass', () => {
    const wsola = new WsolaStretcher({ sampleRate: 48000, channels: 1 });
    wsola.setSpeed(1);
    const input = [new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])];
    wsola.push(input);
    wsola.flush();
    const out = wsola.pull(wsola.available());
    assert.deepEqual(out[0], input[0]);
  });

  test('sine 440 Hz at 1.5x and 2x', () => {
    for (const speed of [1.5, 2]) {
      const wsola = new WsolaStretcher({ sampleRate: 48000, channels: 1 });
      wsola.setSpeed(speed);
      const input = createSine(440, 48000, 10);
      const inputRms = rms(input[0]);

      wsola.push(input);
      wsola.flush();
      const out = wsola.pull(wsola.available())[0];

      // length +- 2%
      const expectedLen = input[0].length / speed;
      assert.ok(
        Math.abs(out.length - expectedLen) / expectedLen <= 0.02,
        `Length off at ${speed}x`
      );

      // freq +- 2%
      // Window in the middle
      const start = Math.floor(out.length * 0.4);
      const end = Math.floor(out.length * 0.6);
      const windowBuf = out.subarray(start, end);
      const freq = estimateFreqZeroCrossing(windowBuf, 48000);
      assert.ok(
        Math.abs(freq - 440) / 440 <= 0.02,
        `Freq off: ${freq} at ${speed}x`
      );

      // RMS +- 10%
      const outRms = rms(out);
      assert.ok(
        Math.abs(outRms - inputRms) / inputRms <= 0.1,
        `RMS off: ${outRms} at ${speed}x`
      );
    }
  });

  test('random chunks vs single push', () => {
    const wsola1 = new WsolaStretcher({ sampleRate: 48000, channels: 1 });
    const wsola2 = new WsolaStretcher({ sampleRate: 48000, channels: 1 });
    wsola1.setSpeed(1.5);
    wsola2.setSpeed(1.5);

    const input = createSine(440, 48000, 1)[0];

    // Single push
    wsola1.push([input]);
    wsola1.flush();
    const out1 = wsola1.pull(wsola1.available())[0];

    // Random chunks (fixed seed pseudo-random)
    let m_w = 123456789;
    let m_z = 987654321;
    function random() {
      m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & 0xffffffff;
      m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & 0xffffffff;
      let result = ((m_z << 16) + m_w) & 0xffffffff;
      return (result + 2147483648) / 4294967296;
    }

    let p = 0;
    while (p < input.length) {
      const chunkLen = Math.floor(random() * 2000) + 1;
      const end = Math.min(p + chunkLen, input.length);
      wsola2.push([input.subarray(p, end)]);
      p = end;
    }
    wsola2.flush();
    const out2 = wsola2.pull(wsola2.available())[0];

    assert.deepEqual(out1, out2);
  });

  test('stereo equal channels', () => {
    const wsola = new WsolaStretcher({ sampleRate: 48000, channels: 2 });
    wsola.setSpeed(1.5);
    const input = createSine(440, 48000, 1, 2);
    wsola.push(input);
    wsola.flush();
    const out = wsola.pull(wsola.available());
    assert.deepEqual(out[0], out[1]);
  });

  test('speed change mid-stream no NaN', () => {
    const wsola = new WsolaStretcher({ sampleRate: 48000, channels: 1 });
    wsola.setSpeed(1.5);
    const input1 = createSine(440, 48000, 1);
    const input2 = createSine(880, 48000, 1);

    wsola.push(input1);
    wsola.setSpeed(2);
    wsola.push(input2);
    wsola.flush();

    const out = wsola.pull(wsola.available())[0];
    for (let i = 0; i < out.length; i++) {
      assert.ok(!Number.isNaN(out[i]));
    }
  });

  test('30s stereo 48kHz at 2x < 3s', () => {
    const wsola = new WsolaStretcher({ sampleRate: 48000, channels: 2 });
    wsola.setSpeed(2);
    const input = createSine(440, 48000, 30, 2);

    const start = performance.now();
    wsola.push(input);
    wsola.flush();
    wsola.pull(wsola.available());
    const end = performance.now();

    assert.ok(end - start < 3000, `Took ${end - start} ms`);
  });
});
