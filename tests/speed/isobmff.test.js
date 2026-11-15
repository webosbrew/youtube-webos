import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBoxes,
  classifyMp4,
  findMdhdTimescale,
  rewriteInitTimescale,
  audioConfigFromInit,
  demuxFragments
} from '../../src/speed/isobmff.js';

const dir = new URL('./fixtures/', import.meta.url);
const load = (name) => new Uint8Array(readFileSync(new URL(name, dir)));

describe('isobmff.js', () => {
  const yt136 = load('yt_136.bin');
  const yt398 = load('yt_398.bin');
  const yt140 = load('yt_140.bin');

  test('parseBoxes', () => {
    const boxes = parseBoxes(yt136, 0, yt136.length);
    assert.equal(boxes[0].type, 'ftyp');
    // We expect some boxes.

    // Test size 1 (64-bit) and 0 (until end) using synthetic boxes
    const synthetic = new Uint8Array([
      0,
      0,
      0,
      1, // size 1
      ...new TextEncoder().encode('mdat'),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      24, // 64-bit size 24
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,

      0,
      0,
      0,
      0, // size 0
      ...new TextEncoder().encode('mdat'),
      1,
      2,
      3,
      4 // until end
    ]);
    const synthBoxes = parseBoxes(synthetic, 0, synthetic.length);
    assert.equal(synthBoxes[0].size, 24);
    assert.equal(synthBoxes[0].headerSize, 16);
    assert.equal(synthBoxes[1].size, 12); // size 0 evaluates to end - start
    assert.equal(synthBoxes[1].end, synthetic.length);
  });

  test('classifyMp4', () => {
    assert.equal(classifyMp4(yt136), 'init+media');
    assert.equal(classifyMp4(yt398), 'init+media'); // it has moov too
    const initOnly = yt136.subarray(
      0,
      parseBoxes(yt136, 0, yt136.length).find((b) => b.type === 'moov').end
    );
    assert.equal(classifyMp4(initOnly), 'init');
  });

  test('findMdhdTimescale', () => {
    const ts136 = findMdhdTimescale(yt136);
    assert.equal(ts136.timescale, 12288);
    const ts140 = findMdhdTimescale(yt140);
    if (ts140) assert.equal(ts140.timescale, 44100);
  });

  test('rewriteInitTimescale', () => {
    const { data, original, scaled } = rewriteInitTimescale(yt136, 1.5);
    assert.equal(original, 12288);
    assert.equal(scaled, 18432);
    const ts = findMdhdTimescale(data);
    assert.equal(ts.timescale, 18432);

    // Check all other bytes are identical
    let diff = 0;
    for (let i = 0; i < yt136.length; i++) {
      if (yt136[i] !== data[i]) diff++;
    }
    assert.equal(diff, 1); // 0x3000 -> 0x4800 (only 1 byte changes)
  });

  test('audioConfigFromInit', () => {
    const config = audioConfigFromInit(yt140);
    assert.equal(config.codec, 'mp4a.40.2');
    assert.equal(config.sampleRate, 44100);
    assert.equal(config.numberOfChannels, 2);
    assert.equal(config.description.length, 16);
    assert.equal(config.description[0], 0x12);
    assert.equal(config.description[1], 0x10);
  });

  test('demuxFragments', () => {
    const { samples, rest } = demuxFragments(yt140, { timescale: 44100 });

    assert.ok(samples.length > 0);
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i].pts > samples[i - 1].pts, 'pts must increase');
    }

    // Check mdat truncated goes into rest
    assert.ok(rest.length > 0);
  });
});
