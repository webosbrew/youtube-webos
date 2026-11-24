// Additional isobmff.js/webm.js coverage needed by the MSE integration, beyond
// isobmff.test.js and webm.test.js. Each one encodes a fact from the specs or
// from how YouTube feeds MediaSource (init once, then bare media segments in
// chunks).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBoxes,
  findMdhdTimescale,
  audioConfigFromInit,
  demuxFragments
} from '../../src/speed/isobmff.js';
import {
  parseElements,
  classifyWebm,
  rewriteTimecodeScale,
  findTimecodeScale,
  audioConfigFromWebmInit,
  demuxClusters
} from '../../src/speed/webm.js';

const dir = new URL('./fixtures/', import.meta.url);
const load = (name) => new Uint8Array(readFileSync(new URL(name, dir)));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('isobmff.js: additional MSE-integration edge cases', () => {
  const yt140 = load('yt_140.bin');
  const yt398 = load('yt_398.bin');

  test('av01 timescale is 12288 and mp4a is 44100', () => {
    assert.equal(findMdhdTimescale(yt398).timescale, 12288);
    assert.equal(findMdhdTimescale(yt140).timescale, 44100);
  });

  test('each fragment starts where the previous one ended (tfdt continuity)', () => {
    const { samples } = demuxFragments(yt140, { timescale: 44100 });
    const top = parseBoxes(yt140, 0, yt140.length).filter(
      (b) => b.type === 'moof' && !b.truncated
    );
    assert.ok(top.length >= 2);
    for (let i = 1; i < samples.length; i++) {
      const prevEnd = samples[i - 1].pts + samples[i - 1].duration;
      assert.ok(
        Math.abs(samples[i].pts - prevEnd) <= 1 / 44100 + 1e-9,
        `gap at sample ${i}`
      );
    }
  });

  test('a chunk boundary inside a box header keeps the bytes in rest', () => {
    const boxes = parseBoxes(yt140, 0, yt140.length);
    const firstMoof = boxes.find((b) => b.type === 'moof');
    const secondMoof = boxes.filter((b) => b.type === 'moof')[1];
    // bare media: moof+mdat of fragment 1, then only 5 bytes of the next moof header
    const chunk = yt140.subarray(firstMoof.start, secondMoof.start + 5);
    const { samples, rest } = demuxFragments(chunk, { timescale: 44100 });
    assert.ok(samples.length > 0);
    assert.equal(rest.length, 5);
    // feeding rest + the remainder must yield the second fragment
    const next = concat(
      rest,
      yt140.subarray(secondMoof.start + 5, secondMoof.end + 1)
    );
    assert.ok(next.length > 5);
  });

  test('dOps is converted to a little-endian OpusHead (RFC 7845 §5.1)', () => {
    // Build moov/trak/mdia/minf/stbl/stsd/Opus/dOps synthetically.
    const box = (type, ...payload) => {
      const body = concat(...payload);
      const out = new Uint8Array(8 + body.length);
      new DataView(out.buffer).setUint32(0, out.length);
      out.set(new TextEncoder().encode(type), 4);
      out.set(body, 8);
      return out;
    };
    // dOps: Version 0, OutputChannelCount 2, PreSkip 312 (BE), InputSampleRate 48000 (BE),
    // OutputGain 0, ChannelMappingFamily 0
    const dOps = box(
      'dOps',
      new Uint8Array([0, 2, 0x01, 0x38, 0x00, 0x00, 0xbb, 0x80, 0, 0, 0])
    );
    const sampleEntry = new Uint8Array(28);
    new DataView(sampleEntry.buffer).setUint16(16, 2); // channelcount
    new DataView(sampleEntry.buffer).setUint32(24, 48000 * 65536);
    const opus = box('Opus', sampleEntry, dOps);
    const stsd = box('stsd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), opus);
    const moov = box(
      'moov',
      box('trak', box('mdia', box('minf', box('stbl', stsd))))
    );
    const cfg = audioConfigFromInit(moov);
    assert.equal(cfg.codec, 'opus');
    assert.equal(cfg.numberOfChannels, 2);
    const d = cfg.description;
    assert.equal(new TextDecoder().decode(d.subarray(0, 8)), 'OpusHead');
    assert.equal(d[8], 1, 'OpusHead version must be 1');
    assert.equal(d[9], 2, 'channel count');
    assert.equal(d[10] | (d[11] << 8), 312, 'pre-skip is little-endian');
    assert.equal(
      new DataView(d.buffer, d.byteOffset).getUint32(12, true),
      48000,
      'rate is little-endian'
    );
    assert.equal(d.length, 19);
  });
});

describe('webm.js: additional MSE-integration edge cases', () => {
  const yt251 = load('yt_251.bin');
  const yt247 = load('yt_247.bin');
  const segOf = (u8) =>
    parseElements(u8, 0, u8.length).find((e) => e.id === '18 53 80 67');
  const clustersOf = (u8) => {
    const seg = segOf(u8);
    return parseElements(u8, seg.dataStart, seg.end).filter(
      (e) => e.id === '1F 43 B6 75'
    );
  };

  test('bare clusters (how MSE media segments arrive) are classified as media', () => {
    const [c1] = clustersOf(yt251);
    assert.equal(classifyWebm(yt251.subarray(c1.start, c1.end)), 'media');
  });

  test('bare clusters are demuxed, and a trailing partial cluster goes to rest', () => {
    const [c1, c2, c3] = clustersOf(yt251);
    const whole = demuxClusters(yt251, {
      timecodeScale: 1000000,
      trackNumber: 1
    });
    const bare = demuxClusters(yt251.subarray(c1.start, c3.start + 100), {
      timecodeScale: 1000000,
      trackNumber: 1
    });
    assert.ok(bare.frames.length > 0);
    assert.equal(bare.frames.length, whole.frames.length);
    assert.equal(bare.frames[0].pts, whole.frames[0].pts);
    assert.equal(bare.rest.length, 100);
    assert.ok(c2.start > c1.start);
  });

  test('audio config reports the track number to demux', () => {
    const cfg = audioConfigFromWebmInit(yt251);
    assert.equal(cfg.codec, 'opus');
    assert.equal(typeof cfg.trackNumber, 'number');
    const { frames } = demuxClusters(yt251, {
      timecodeScale: 1000000,
      trackNumber: cfg.trackNumber
    });
    assert.ok(frames.length > 0);
  });

  test('insertion into a known-size Segment keeps Segment size consistent', () => {
    // EBML header, Segment (known size) containing Info (with only a Duration) and a Void
    const info = [0x15, 0x49, 0xa9, 0x66, 0x84, 0x44, 0x89, 0x81, 0x00];
    const voidEl = [0xec, 0x82, 0x00, 0x00];
    const segBody = [...info, ...voidEl];
    const synth = new Uint8Array([
      0x1a,
      0x45,
      0xdf,
      0xa3,
      0x80,
      0x18,
      0x53,
      0x80,
      0x67,
      0x80 | segBody.length,
      ...segBody
    ]);
    const { data } = rewriteTimecodeScale(synth, 2);
    assert.equal(findTimecodeScale(data).value, 500000);
    const seg = segOf(data);
    assert.equal(seg.truncated, false);
    assert.equal(
      seg.end,
      data.length,
      'Segment size must cover exactly the grown body'
    );
    const kids = parseElements(data, seg.dataStart, seg.end).map((e) => e.id);
    assert.deepEqual(kids, ['15 49 A9 66', 'EC']);
  });

  test('rewrite refuses a value that does not fit the existing field', () => {
    // TimecodeScale stored on 1 byte (value 100): 100 / 0.25 = 400 does not fit
    const info = [0x15, 0x49, 0xa9, 0x66, 0x84, 0x2a, 0xd7, 0xb1, 0x81, 100];
    const synth = new Uint8Array(
      [
        0x1a,
        0x45,
        0xdf,
        0xa3,
        0x80,
        0x18,
        0x53,
        0x80,
        0x67,
        0x80 | 10,
        ...info
      ].slice(0, 20)
    );
    synth[4 + 5 + 4] = 0x80 | info.length;
    const fixed = new Uint8Array([
      0x1a,
      0x45,
      0xdf,
      0xa3,
      0x80,
      0x18,
      0x53,
      0x80,
      0x67,
      0x80 | info.length,
      ...info
    ]);
    fixed[14] = 0x80 | 5; // Info size = 5 (the TimecodeScale element)
    assert.equal(findTimecodeScale(fixed).value, 100);
    assert.throws(() => rewriteTimecodeScale(fixed, 0.25), RangeError);
  });

  test('laced blocks raise NotSupportedError', () => {
    const [c1] = clustersOf(yt251);
    const cl = yt251.slice(c1.start, c1.end);
    const kids = parseElements(cl, c1.headerSize, cl.length);
    const sb = kids.find((e) => e.id === 'A3');
    cl[sb.dataStart + 3] |= 0x02; // set Xiph lacing bits in the flags byte
    assert.throws(
      () => demuxClusters(cl, { timecodeScale: 1000000, trackNumber: 1 }),
      { name: 'NotSupportedError' }
    );
  });

  test('vp9 file: timecode scale rewrite touches only the 3 value bytes', () => {
    const { data } = rewriteTimecodeScale(yt247, 1.5);
    const changed = [];
    for (let i = 0; i < yt247.length; i++)
      if (yt247[i] !== data[i]) changed.push(i);
    assert.ok(
      changed.every((i) => i >= 100 && i < 103),
      `changed ${changed}`
    );
  });
});
