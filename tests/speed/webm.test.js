import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  findTimecodeScale,
  rewriteTimecodeScale,
  demuxClusters
} from '../../src/speed/webm.js';

const dir = new URL('./fixtures/', import.meta.url);
const load = (name) => new Uint8Array(readFileSync(new URL(name, dir)));

describe('webm.js', () => {
  const yt247 = load('yt_247.bin');
  const yt251 = load('yt_251.bin');

  test('findTimecodeScale', () => {
    const scale247 = findTimecodeScale(yt247);
    assert.equal(scale247.offset, 96);
    assert.equal(scale247.value, 1000000);

    const scale251 = findTimecodeScale(yt251);
    assert.equal(scale251.offset, 121);
    assert.equal(scale251.value, 1000000);
  });

  test('rewriteTimecodeScale', () => {
    // 2x
    const res2x = rewriteTimecodeScale(yt247, 2);
    assert.equal(res2x.scaled, 500000);
    const ts2x = findTimecodeScale(res2x.data);
    assert.equal(ts2x.value, 500000);
    // same length Check
    let diff = 0;
    for (let i = 0; i < yt247.length; i++) {
      if (yt247[i] !== res2x.data[i]) diff++;
    }
    // TimecodeScale value is 3 bytes (as per prompt). 1,000,000 is 0x0F4240.
    // 500,000 is 0x07A120. So at most 3 bytes changed.
    assert.ok(diff <= 3);

    // 1.5x
    const res15x = rewriteTimecodeScale(yt247, 1.5);
    assert.equal(res15x.scaled, 666667);
  });

  test('rewriteTimecodeScale - insert', () => {
    // We need a synthetic init without TimecodeScale
    // EBML (0x1A45DFA3) + Segment (0x18538067) + Info (0x1549A966)
    // We will just craft a minimal valid one.
    // Let's create an EBML header: 1A 45 DF A3 9F (size 31) -> let's say unknown size
    // For simplicity, we just use bytes.
    const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
    // Segment (0x18 53 80 67) size unknown (01 FF FF ...)
    const segment = [
      0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
    ];
    // Info (0x15 49 A9 66) size 0
    const info = [0x15, 0x49, 0xa9, 0x66, 0x80];
    const synth = new Uint8Array([...ebml, ...segment, ...info]);

    assert.equal(findTimecodeScale(synth), null);

    const { data, original, scaled } = rewriteTimecodeScale(synth, 1.5);
    assert.equal(original, 1000000); // Default is 1000000
    assert.equal(scaled, 666667);

    const reRead = findTimecodeScale(data);
    assert.equal(reRead.value, 666667);
  });

  test('demuxClusters pts', () => {
    const { frames, rest } = demuxClusters(yt251, {
      timecodeScale: 1000000,
      trackNumber: 1
    });
    assert.ok(frames.length > 0);
    for (let i = 1; i < frames.length; i++) {
      assert.ok(frames[i].pts >= frames[i - 1].pts);
    }
    assert.ok(rest.length > 0); // cluster truncated
  });
});
