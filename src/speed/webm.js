export function readVint(u8, start) {
  if (start >= u8.length) return null;
  const b = u8[start];
  let length = 0;
  let mask = 0x80;
  while (length < 8) {
    length++;
    if (b & mask) break;
    mask >>= 1;
  }
  if (length === 8 && !(b & mask)) return null;
  if (start + length > u8.length) return null;

  let value = b & ~mask;
  let allOnes = (b & ~mask) === (1 << (8 - length)) - 1;
  for (let i = 1; i < length; i++) {
    const nextByte = u8[start + i];
    value = value * 256 + nextByte;
    if (nextByte !== 0xff) allOnes = false;
  }

  if (allOnes && length > 1) {
    value = -1;
  } else if (length === 1 && b === 0xff) {
    value = -1;
  }

  if (value > Number.MAX_SAFE_INTEGER)
    throw new Error('Vint exceeds MAX_SAFE_INTEGER');

  return { value, length };
}

export function parseElements(u8, start, end) {
  const elements = [];
  let p = start;
  while (p < end) {
    if (p >= u8.length) break;
    const idVint = readVint(u8, p);
    if (!idVint) break;
    const idBytes = u8.subarray(p, p + idVint.length);
    const idHex = Array.from(idBytes)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');

    p += idVint.length;
    const sizeVint = readVint(u8, p);
    if (!sizeVint) break;

    const headerSize = idVint.length + sizeVint.length;
    p += sizeVint.length;

    let size = sizeVint.value;
    if (size === -1) {
      size = end - p; // Until end of parent
    }

    if (p + size > u8.length) {
      elements.push({
        id: idHex,
        start: p - headerSize,
        headerSize,
        size: u8.length - p,
        dataStart: p,
        end: u8.length,
        truncated: true
      });
      break;
    }

    elements.push({
      id: idHex,
      start: p - headerSize,
      headerSize,
      size,
      dataStart: p,
      end: p + size,
      truncated: false
    });
    p += size;
  }
  return elements;
}

const SEGMENT = '18 53 80 67';
const CLUSTER = '1F 43 B6 75';

/**
 * Segment children, whether the buffer holds a whole file (EBML + Segment) or,
 * as MSE media segments do, bare level-1 elements such as Clusters.
 * @param {Uint8Array} u8
 */
function levelOne(u8) {
  const top = parseElements(u8, 0, u8.length);
  const segment = top.find((e) => e.id === SEGMENT);
  if (segment) return parseElements(u8, segment.dataStart, segment.end);
  return top;
}

export function classifyWebm(u8) {
  const children = levelOne(u8);
  const hasInfo = children.some((e) => e.id === '15 49 A9 66');
  const hasCluster = children.some((e) => e.id === '1F 43 B6 75');

  if (hasInfo && hasCluster) return 'init+media';
  if (hasInfo) return 'init';
  if (hasCluster) return 'media';
  return 'unknown';
}

export function findTimecodeScale(u8) {
  const elements = parseElements(u8, 0, u8.length);
  const segment = elements.find((e) => e.id === '18 53 80 67');
  if (!segment) return null;
  const children = parseElements(u8, segment.dataStart, segment.end);
  const info = children.find((e) => e.id === '15 49 A9 66');
  if (!info) return null;
  const infoChildren = parseElements(u8, info.dataStart, info.end);
  const tcScale = infoChildren.find((e) => e.id === '2A D7 B1');
  if (!tcScale) return null;

  let value = 0;
  for (let i = 0; i < tcScale.size; i++) {
    value = value * 256 + u8[tcScale.dataStart + i];
  }
  return {
    offset: tcScale.start,
    dataOffset: tcScale.dataStart,
    value,
    size: tcScale.size
  };
}

function encodeVint(val) {
  if (val === -1) return [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  if (val < 127) return [0x80 | val];
  if (val < 16383) return [0x40 | (val >> 8), val & 0xff];
  if (val < 2097151) return [0x20 | (val >> 16), (val >> 8) & 0xff, val & 0xff];
  if (val < 268435455)
    return [
      0x10 | (val >> 24),
      (val >> 16) & 0xff,
      (val >> 8) & 0xff,
      val & 0xff
    ];
  let buf = [0x08, 0, 0, 0, 0];
  let v = val;
  for (let i = 4; i >= 1; i--) {
    buf[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  buf[0] |= v;
  return buf;
}

export function rewriteTimecodeScale(u8, speed) {
  const ts = findTimecodeScale(u8);
  const original = ts ? ts.value : 1000000;
  const scaled = Math.round(original / speed);

  if (ts) {
    if (scaled >= 2 ** (8 * ts.size)) {
      throw new RangeError(
        `TimecodeScale ${scaled} does not fit in ${ts.size} bytes`
      );
    }
    const data = new Uint8Array(u8);
    let v = scaled;
    for (let i = ts.size - 1; i >= 0; i--) {
      data[ts.dataOffset + i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    return {
      data,
      original,
      scaled,
      relativeError: Math.abs(scaled - original / speed) / (original / speed)
    };
  } else {
    const elements = parseElements(u8, 0, u8.length);
    const segment = elements.find((e) => e.id === '18 53 80 67');
    const children = parseElements(u8, segment.dataStart, segment.end);
    const info = children.find((e) => e.id === '15 49 A9 66');

    const newElement = new Uint8Array([0x2a, 0xd7, 0xb1, 0x83, 0, 0, 0]);
    let v = scaled;
    for (let i = 2; i >= 0; i--) {
      newElement[4 + i] = v & 0xff;
      v = Math.floor(v / 256);
    }

    const infoIdVint = readVint(u8, info.start);
    const infoSizeVint = readVint(u8, info.start + infoIdVint.length);
    const oldInfoSize = infoSizeVint.value;

    const segmentIdVint = readVint(u8, segment.start);
    const segmentSizeVint = readVint(u8, segment.start + segmentIdVint.length);
    const oldSegmentSize = segmentSizeVint.value;

    const newInfoSize = oldInfoSize === -1 ? -1 : oldInfoSize + 7;
    const newInfoSizeEncoded = encodeVint(newInfoSize);
    const infoSizeDiff = newInfoSizeEncoded.length - infoSizeVint.length;

    const newSegmentSize =
      oldSegmentSize === -1 ? -1 : oldSegmentSize + 7 + infoSizeDiff;
    const newSegmentSizeEncoded = encodeVint(newSegmentSize);
    const segmentSizeDiff =
      newSegmentSizeEncoded.length - segmentSizeVint.length;

    const totalDiff = 7 + infoSizeDiff + segmentSizeDiff;
    const data = new Uint8Array(u8.length + totalDiff);

    let dest = 0;
    const segSizeOffset = segment.start + segmentIdVint.length;
    data.set(u8.subarray(0, segSizeOffset), dest);
    dest += segSizeOffset;

    data.set(newSegmentSizeEncoded, dest);
    dest += newSegmentSizeEncoded.length;

    const infoSizeOffset = info.start + infoIdVint.length;
    data.set(
      u8.subarray(segSizeOffset + segmentSizeVint.length, infoSizeOffset),
      dest
    );
    dest += infoSizeOffset - (segSizeOffset + segmentSizeVint.length);

    data.set(newInfoSizeEncoded, dest);
    dest += newInfoSizeEncoded.length;

    data.set(newElement, dest);
    dest += newElement.length;

    const restStart = infoSizeOffset + infoSizeVint.length;
    data.set(u8.subarray(restStart), dest);

    return {
      data,
      original,
      scaled,
      relativeError: Math.abs(scaled - original / speed) / (original / speed)
    };
  }
}

export function audioConfigFromWebmInit(u8) {
  const elements = parseElements(u8, 0, u8.length);
  const segment = elements.find((e) => e.id === '18 53 80 67');
  if (!segment) return { unsupported: true };
  const children = parseElements(u8, segment.dataStart, segment.end);
  const tracks = children.find((e) => e.id === '16 54 AE 6B');
  if (!tracks) return { unsupported: true };
  const trackEntries = parseElements(u8, tracks.dataStart, tracks.end).filter(
    (e) => e.id === 'AE'
  );

  for (const track of trackEntries) {
    const tChildren = parseElements(u8, track.dataStart, track.end);
    const codecId = tChildren.find((e) => e.id === '86');
    if (codecId) {
      const codecStr = new TextDecoder().decode(
        u8.subarray(codecId.dataStart, codecId.end)
      );
      if (codecStr === 'A_OPUS') {
        let channels = 2;
        let sampleRate = 48000;
        const audio = tChildren.find((e) => e.id === 'E1');
        if (audio) {
          const aChildren = parseElements(u8, audio.dataStart, audio.end);
          const ch = aChildren.find((e) => e.id === '9F');
          if (ch) {
            channels = 0;
            for (let i = 0; i < ch.size; i++)
              channels = channels * 256 + u8[ch.dataStart + i];
          }
        }

        const codecPrivate = tChildren.find((e) => e.id === '63 A2');
        if (!codecPrivate || codecPrivate.truncated)
          return { unsupported: true, codec: 'opus' };
        const description = new Uint8Array(
          u8.buffer,
          u8.byteOffset + codecPrivate.dataStart,
          codecPrivate.size
        );
        const numEl = tChildren.find((e) => e.id === 'D7');
        let trackNumber = 1;
        if (numEl) {
          trackNumber = 0;
          for (let i = 0; i < numEl.size; i++)
            trackNumber = trackNumber * 256 + u8[numEl.dataStart + i];
        }

        return {
          codec: 'opus',
          sampleRate,
          numberOfChannels: channels,
          description,
          trackNumber
        };
      }
    }
  }
  return { unsupported: true };
}

export function demuxClusters(u8, { timecodeScale, trackNumber }) {
  const frames = [];
  let restStart = u8.length;

  const children = levelOne(u8);
  const clusters = children.filter((e) => e.id === CLUSTER);
  // Bytes after the last complete element (e.g. a chunk that ends inside an
  // element header, which parseElements cannot even list) belong to rest too.
  const last = children[children.length - 1];
  if (
    last &&
    !last.truncated &&
    last.end < u8.length &&
    children.every((e) => e.id !== SEGMENT)
  ) {
    restStart = last.end;
  }

  for (const cluster of clusters) {
    if (cluster.truncated) {
      restStart = Math.min(restStart, cluster.start);
      continue;
    }

    let clusterValid = true;
    const cChildren = parseElements(u8, cluster.dataStart, cluster.end);
    const timecodeEl = cChildren.find((e) => e.id === 'E7');
    let clusterTimecode = 0;
    if (timecodeEl) {
      for (let i = 0; i < timecodeEl.size; i++)
        clusterTimecode = clusterTimecode * 256 + u8[timecodeEl.dataStart + i];
    }

    for (const el of cChildren) {
      if (el.truncated) {
        clusterValid = false;
        break;
      }
      if (el.id === 'A3' || el.id === 'A0') {
        let blockDataStart = el.dataStart;
        let blockDataEnd = el.end;
        let isSimple = el.id === 'A3';
        if (!isSimple) {
          const bgChildren = parseElements(u8, el.dataStart, el.end);
          const blockEl = bgChildren.find((e) => e.id === 'A1');
          if (!blockEl) continue;
          if (blockEl.truncated) {
            clusterValid = false;
            break;
          }
          blockDataStart = blockEl.dataStart;
          blockDataEnd = blockEl.end;
        }

        let p = blockDataStart;
        const trackNumVint = readVint(u8, p);
        if (!trackNumVint) {
          clusterValid = false;
          break;
        }
        if (trackNumVint.value !== trackNumber) continue;

        p += trackNumVint.length;
        if (p + 2 > blockDataEnd) {
          clusterValid = false;
          break;
        }

        const relativeTimecode = (u8[p] << 8) | u8[p + 1];
        const rtSigned =
          relativeTimecode >= 32768
            ? relativeTimecode - 65536
            : relativeTimecode;
        p += 2;

        const flags = u8[p++];
        const lacing = (flags & 0x06) >> 1;
        if (lacing !== 0) {
          const err = new Error('Lacing not supported');
          err.name = 'NotSupportedError';
          throw err;
        }

        const key = isSimple ? (flags & 0x80) !== 0 : true;
        const pts = ((clusterTimecode + rtSigned) * timecodeScale) / 1000000000;
        const data = new Uint8Array(
          u8.buffer,
          u8.byteOffset + p,
          blockDataEnd - p
        );

        frames.push({ pts, data, key, start: el.start });
      }
    }

    if (!clusterValid) {
      restStart = Math.min(restStart, cluster.start);
    }
  }

  const validFrames = frames
    .filter((f) => f.start < restStart)
    .map((f) => ({ pts: f.pts, data: f.data, key: f.key }));
  const rest = new Uint8Array(
    u8.buffer,
    u8.byteOffset + restStart,
    u8.length - restStart
  );
  return { frames: validFrames, rest };
}
