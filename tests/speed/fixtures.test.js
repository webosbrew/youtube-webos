// Sanity checks on the real YouTube DASH fixtures (see fixtures/README.md for
// what each one is and how it was cut down from the original captures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dir = new URL('./fixtures/', import.meta.url);
const load = (name) => new Uint8Array(readFileSync(new URL(name, dir)));

const SIZES = { 'yt_136.bin': 3756, 'yt_398.bin': 3396, 'yt_140.bin': 327131 };

test('mp4 fixtures start with ftyp and have the expected length', () => {
  for (const f of ['yt_136.bin', 'yt_398.bin', 'yt_140.bin']) {
    const b = load(f);
    assert.equal(b.length, SIZES[f]);
    assert.equal(String.fromCharCode(...b.subarray(4, 8)), 'ftyp');
  }
});

const WEBM_SIZES = { 'yt_247.bin': 220, 'yt_251.bin': 306614 };

test('webm fixtures start with the EBML magic and have the expected length', () => {
  for (const f of ['yt_247.bin', 'yt_251.bin']) {
    const b = load(f);
    assert.equal(b.length, WEBM_SIZES[f]);
    assert.deepEqual([...b.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  }
});
