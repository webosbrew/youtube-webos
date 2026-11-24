/**
 * Parses MP4 boxes from a Uint8Array.
 * @param {Uint8Array} u8
 * @param {number} start
 * @param {number} end
 * @returns {Array<{type: string, start: number, headerSize: number, size: number, end: number, truncated: boolean}>}
 */
export function parseBoxes(u8, start, end) {
  const boxes = [];
  let i = start;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  while (i < end) {
    if (i + 8 > end) {
      boxes.push({
        type: '',
        start: i,
        headerSize: 0,
        size: 0,
        end,
        truncated: true
      });
      break;
    }
    let size = view.getUint32(i);
    let type = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
    let headerSize = 8;
    if (size === 1) {
      if (i + 16 > end) {
        boxes.push({
          type,
          start: i,
          headerSize: 16,
          size: 1,
          end,
          truncated: true
        });
        break;
      }
      const hi = view.getUint32(i + 8);
      const lo = view.getUint32(i + 12);
      if (hi > 0x1fffff) throw new Error('Size exceeds MAX_SAFE_INTEGER');
      size = hi * 0x100000000 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = end - i;
    }

    if (i + size > end || size < headerSize) {
      boxes.push({ type, start: i, headerSize, size, end, truncated: true });
      break;
    }

    boxes.push({
      type,
      start: i,
      headerSize,
      size,
      end: i + size,
      truncated: false
    });
    i += size;
  }
  return boxes;
}

/**
 * Classifies an MP4 file.
 * @param {Uint8Array} u8
 * @returns {'init' | 'media' | 'init+media' | 'unknown'}
 */
export function classifyMp4(u8) {
  const boxes = parseBoxes(u8, 0, u8.length);
  const types = new Set(boxes.map((b) => b.type));
  if (types.has('moov') && types.has('moof')) return 'init+media';
  if (types.has('moov')) return 'init';
  if (types.has('moof')) return 'media';
  return 'unknown';
}

function dfs(u8, start, end, target) {
  const boxes = parseBoxes(u8, start, end);
  for (const box of boxes) {
    if (box.type === target) return box;
    if (
      ['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf'].includes(
        box.type
      )
    ) {
      if (!box.truncated) {
        const res = dfs(u8, box.start + box.headerSize, box.end, target);
        if (res) return res;
      }
    }
  }
  return null;
}

/**
 * Finds mdhd and its timescale.
 * @param {Uint8Array} u8
 * @returns {{offset: number, version: number, timescale: number} | null}
 */
export function findMdhdTimescale(u8) {
  const mdhd = dfs(u8, 0, u8.length, 'mdhd');
  if (!mdhd || mdhd.truncated) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = view.getUint8(mdhd.start + mdhd.headerSize);
  let offset = mdhd.start + mdhd.headerSize + 4;
  if (version === 1) {
    offset += 16;
  } else {
    offset += 8;
  }
  const timescale = view.getUint32(offset);
  return { offset, version, timescale };
}

/**
 * Rewrites the timescale in the init segment.
 * @param {Uint8Array} u8
 * @param {number} speed
 */
export function rewriteInitTimescale(u8, speed) {
  const ts = findMdhdTimescale(u8);
  if (!ts) throw new RangeError('mdhd not found');
  const scaled = Math.round(ts.timescale * speed);
  const data = new Uint8Array(u8);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint32(ts.offset, scaled);
  return {
    data,
    original: ts.timescale,
    scaled,
    relativeError:
      Math.abs(scaled - ts.timescale * speed) / (ts.timescale * speed)
  };
}

function readDescr(view, start, end) {
  let p = start;
  if (p >= end) return null;
  const tag = view.getUint8(p++);
  let len = 0;
  let b;
  do {
    if (p >= end) return null;
    b = view.getUint8(p++);
    len = (len << 7) | (b & 0x7f);
  } while (b & 0x80);
  return { tag, len, start: p, end: p + len };
}

/**
 * Converts an ISO-BMFF `dOps` payload to the `OpusHead` WebCodecs expects.
 * The two carry the same fields but `dOps` is big-endian with Version 0, while
 * OpusHead (RFC 7845 §5.1) is little-endian with version 1: a plain copy with the
 * magic prepended would give the decoder a wrong pre-skip and sample rate.
 * @param {Uint8Array} d
 * @returns {Uint8Array}
 */
function opusHeadFromDOps(d) {
  const src = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out = new Uint8Array(19 + Math.max(0, d.length - 11));
  const dst = new DataView(out.buffer);
  out.set([79, 112, 117, 115, 72, 101, 97, 100], 0); // "OpusHead"
  out[8] = 1;
  out[9] = d[1];
  dst.setUint16(10, src.getUint16(2), true);
  dst.setUint32(12, src.getUint32(4), true);
  dst.setInt16(16, src.getInt16(8), true);
  out[18] = d[10];
  // Channel mapping table (family != 0) has the same layout in both formats.
  out.set(d.subarray(11), 19);
  return out;
}

/**
 * Reads what the fragment demuxer needs from an init segment: the track
 * timescale and the `trex` defaults (YouTube relies on tfhd defaults, but a
 * fragment without them falls back to trex).
 * @param {Uint8Array} u8
 * @returns {{timescale: number, trex: {defaultDuration: number, defaultSize: number, defaultFlags: number} | undefined} | null}
 */
export function parseInitInfo(u8) {
  const ts = findMdhdTimescale(u8);
  if (!ts) return null;
  const trexBox = dfs(u8, 0, u8.length, 'trex');
  let trex;
  if (trexBox && !trexBox.truncated) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const p = trexBox.start + trexBox.headerSize + 4; // FullBox header
    trex = {
      defaultDuration: view.getUint32(p + 8),
      defaultSize: view.getUint32(p + 12),
      defaultFlags: view.getUint32(p + 16)
    };
  }
  return { timescale: ts.timescale, trex };
}

/**
 * Extracts audio config from init segment.
 * @param {Uint8Array} u8
 */
export function audioConfigFromInit(u8) {
  const stsd = dfs(u8, 0, u8.length, 'stsd');
  if (!stsd || stsd.truncated) return { unsupported: true };

  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let offset = stsd.start + stsd.headerSize + 8;
  const entries = parseBoxes(u8, offset, stsd.end);

  for (const entry of entries) {
    if (entry.type === 'mp4a') {
      const channelCount = view.getUint16(entry.start + entry.headerSize + 16);
      const sampleRate =
        view.getUint32(entry.start + entry.headerSize + 24) >>> 16;
      const esds = dfs(
        u8,
        entry.start + entry.headerSize + 28,
        entry.end,
        'esds'
      );
      if (esds) {
        let p = esds.start + esds.headerSize + 4; // skip FullBox
        let esDescr = readDescr(view, p, esds.end);
        if (esDescr && esDescr.tag === 0x03) {
          let decConfStart = esDescr.start + 3;
          let decConf = readDescr(view, decConfStart, esDescr.end);
          if (decConf && decConf.tag === 0x04) {
            let decSpecStart = decConf.start + 13;
            let decSpec = readDescr(view, decSpecStart, decConf.end);
            if (decSpec && decSpec.tag === 0x05) {
              const description = new Uint8Array(
                u8.buffer,
                u8.byteOffset + decSpec.start,
                decSpec.len
              );
              // The codec string must carry the real Audio Object Type (2 = LC, 5 = HE-AAC, ...).
              const aot = description.length ? description[0] >> 3 : 2;
              return {
                codec: `mp4a.40.${aot}`,
                sampleRate,
                numberOfChannels: channelCount,
                description
              };
            }
          }
        }
      }
    } else if (entry.type === 'Opus') {
      const channelCount = view.getUint16(entry.start + entry.headerSize + 16);
      const dOps = dfs(
        u8,
        entry.start + entry.headerSize + 28,
        entry.end,
        'dOps'
      );
      if (dOps) {
        return {
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: channelCount,
          description: opusHeadFromDOps(
            u8.subarray(dOps.start + dOps.headerSize, dOps.end)
          )
        };
      }
    } else if (
      entry.type === 'avc1' ||
      entry.type === 'av01' ||
      entry.type === 'vp09'
    ) {
      return { unsupported: true, codec: entry.type };
    }
  }
  return { unsupported: true };
}

/**
 * Demuxes media fragments.
 * @param {Uint8Array} u8
 * @param {{timescale: number, trex?: any}} options
 */
export function demuxFragments(u8, { timescale, trex }) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const samples = [];
  const boxes = parseBoxes(u8, 0, u8.length);

  let restStart = u8.length;

  const defaultDuration = trex ? trex.defaultDuration : 0;
  const defaultSize = trex ? trex.defaultSize : 0;
  const defaultFlags = trex ? trex.defaultFlags : 0;

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    // A chunk may end anywhere, even inside an 8-byte box header: whatever is
    // incomplete must be handed back so the caller can prepend it to the next chunk.
    if (box.truncated && box.type !== 'moof') {
      restStart = Math.min(restStart, box.start);
      continue;
    }
    if (box.type === 'moof') {
      if (box.truncated) {
        restStart = Math.min(restStart, box.start);
        continue;
      }
      const trafBoxes = parseBoxes(
        u8,
        box.start + box.headerSize,
        box.end
      ).filter((b) => b.type === 'traf');

      let moofValid = true;
      let moofSamples = [];

      for (const traf of trafBoxes) {
        const trBoxes = parseBoxes(u8, traf.start + traf.headerSize, traf.end);
        const tfhd = trBoxes.find((b) => b.type === 'tfhd');
        const tfdt = trBoxes.find((b) => b.type === 'tfdt');
        const trunList = trBoxes.filter((b) => b.type === 'trun');

        let baseDataOffset = box.start;
        let trafDefaultDuration = defaultDuration;
        let trafDefaultSize = defaultSize;
        let trafDefaultFlags = defaultFlags;

        if (tfhd) {
          const flags = view.getUint32(tfhd.start + tfhd.headerSize) & 0xffffff;
          // FullBox header (4) + track_ID (4): the optional fields start after both.
          let p = tfhd.start + tfhd.headerSize + 8;
          if (flags & 0x01) {
            const hi = view.getUint32(p);
            const lo = view.getUint32(p + 4);
            baseDataOffset = hi * 0x100000000 + lo;
            p += 8;
          } else if (flags & 0x20000) {
            baseDataOffset = box.start;
          }
          if (flags & 0x02) p += 4;
          if (flags & 0x08) {
            trafDefaultDuration = view.getUint32(p);
            p += 4;
          }
          if (flags & 0x10) {
            trafDefaultSize = view.getUint32(p);
            p += 4;
          }
          if (flags & 0x20) {
            trafDefaultFlags = view.getUint32(p);
          }
        }

        let currentDecodeTime = 0;
        if (tfdt) {
          const version = view.getUint8(tfdt.start + tfdt.headerSize);
          if (version === 1) {
            const hi = view.getUint32(tfdt.start + tfdt.headerSize + 4);
            const lo = view.getUint32(tfdt.start + tfdt.headerSize + 8);
            currentDecodeTime = hi * 0x100000000 + lo;
          } else {
            currentDecodeTime = view.getUint32(
              tfdt.start + tfdt.headerSize + 4
            );
          }
        }

        for (const trun of trunList) {
          const version = view.getUint8(trun.start + trun.headerSize);
          const flags = view.getUint32(trun.start + trun.headerSize) & 0xffffff;
          let p = trun.start + trun.headerSize + 4;

          const sampleCount = view.getUint32(p);
          p += 4;
          let dataOffset = 0;
          if (flags & 0x01) {
            dataOffset = view.getInt32(p);
            p += 4;
          }
          let firstSampleFlags = 0;
          if (flags & 0x04) {
            firstSampleFlags = view.getUint32(p);
            p += 4;
          }

          let trunDataOffset = baseDataOffset + dataOffset;

          for (let s = 0; s < sampleCount; s++) {
            let duration = trafDefaultDuration;
            let size = trafDefaultSize;
            let sampleFlags =
              s === 0 && flags & 0x04 ? firstSampleFlags : trafDefaultFlags;
            let cto = 0;

            if (flags & 0x100) {
              duration = view.getUint32(p);
              p += 4;
            }
            if (flags & 0x200) {
              size = view.getUint32(p);
              p += 4;
            }
            if (flags & 0x400) {
              sampleFlags = view.getUint32(p);
              p += 4;
            }
            if (flags & 0x800) {
              cto = version === 1 ? view.getInt32(p) : view.getUint32(p);
              p += 4;
            }

            const isNonSync = (sampleFlags >> 16) & 1;
            const key = isNonSync === 0;

            const pts = (currentDecodeTime + cto) / timescale;
            const durSec = duration / timescale;

            if (trunDataOffset + size > u8.length) {
              moofValid = false;
              break;
            }

            const data = new Uint8Array(
              u8.buffer,
              u8.byteOffset + trunDataOffset,
              size
            );
            moofSamples.push({ pts, duration: durSec, data, key });
            trunDataOffset += size;
            currentDecodeTime += duration;
          }
          if (!moofValid) break;
        }
        if (!moofValid) break;
      }

      if (!moofValid) {
        restStart = Math.min(restStart, box.start);
      } else {
        samples.push(...moofSamples);
      }
    } else if (box.type === 'mdat') {
      if (box.start >= restStart) {
        // Already truncated by earlier moof
      } else if (box.truncated) {
        restStart = Math.min(restStart, box.start);
      }
    }
  }

  const rest = new Uint8Array(
    u8.buffer,
    u8.byteOffset + restStart,
    u8.length - restStart
  );
  return { samples, rest };
}
