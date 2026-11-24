/**
 * Supported playback speeds.
 * @type {number[]}
 */
export const SUPPORTED_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Checks if a speed is supported.
 * @param {number} speed
 * @returns {boolean}
 */
export function isSupportedSpeed(speed) {
  return SUPPORTED_SPEEDS.includes(speed);
}

function checkSpeed(value) {
  if (!isSupportedSpeed(value)) {
    throw new TypeError(`Unsupported speed: ${value}`);
  }
}

/**
 * Maps time between element time and content time.
 *
 * The map is piecewise linear: a list of segments, each starting at content
 * time c0 / element time e0 and running at speed s, so the speed can change in
 * the middle of a MediaSource (from a fragment boundary on) without a reload.
 * Consecutive segments meet, so the map stays continuous and monotonic.
 */
export class SpeedTimeMap {
  /**
   * @param {number} speed
   */
  constructor(speed) {
    checkSpeed(speed);
    /** @type {{c0: number, e0: number, s: number}[]} */
    this.segments = [{ c0: 0, e0: 0, s: speed }];
  }

  /**
   * The speed of the last segment: the one new media is heading to.
   * @returns {number}
   */
  get speed() {
    return this.segments[this.segments.length - 1].s;
  }

  /**
   * Sets one speed for the whole timeline. Throws if unsupported.
   * @param {number} value
   */
  set speed(value) {
    checkSpeed(value);
    this.segments = [{ c0: 0, e0: 0, s: value }];
  }

  segmentAtContent(c) {
    const segs = this.segments;
    for (let i = segs.length - 1; i > 0; i--) {
      if (c >= segs[i].c0) return segs[i];
    }
    return segs[0];
  }

  segmentAtElement(e) {
    const segs = this.segments;
    for (let i = segs.length - 1; i > 0; i--) {
      if (e >= segs[i].e0) return segs[i];
    }
    return segs[0];
  }

  /**
   * The speed media at content time c plays at.
   * @param {number} c
   */
  speedAtContent(c) {
    return this.segmentAtContent(c).s;
  }

  /**
   * From content time c0 on, play at speed s. Later segments are dropped.
   * @param {number} c0
   * @param {number} s
   * @returns {{c0: number, e0: number, s: number}}
   */
  addSegment(c0, s) {
    checkSpeed(s);
    const e0 = this.toElement(c0);
    this.segments = this.segments.filter((seg, i) => i === 0 || seg.c0 < c0);
    if (this.segments.length === 1 && c0 <= this.segments[0].c0) {
      this.segments = [];
    }
    const seg = { c0, e0, s };
    this.segments.push(seg);
    return seg;
  }

  /**
   * Converts content time to element time.
   * @param {number} t
   * @returns {number}
   */
  toElement(t) {
    if (t === Infinity || t === -Infinity) return t;
    const seg = this.segmentAtContent(t);
    return seg.e0 + (t - seg.c0) / seg.s;
  }

  /**
   * Converts element time to content time.
   * @param {number} t
   * @returns {number}
   */
  toContent(t) {
    if (t === Infinity || t === -Infinity) return t;
    const seg = this.segmentAtElement(t);
    return seg.c0 + (t - seg.e0) * seg.s;
  }

  /**
   * Maps a TimeRanges-like object to a new one using the specified direction.
   * @param {{length: number, start: (i: number) => number, end: (i: number) => number}} ranges
   * @param {'toContent'|'toElement'} direction
   * @returns {{length: number, start: (i: number) => number, end: (i: number) => number}}
   */
  mapRanges(ranges, direction) {
    const mapFn =
      direction === 'toContent'
        ? (t) => this.toContent(t)
        : (t) => this.toElement(t);
    return {
      length: ranges.length,
      start(i) {
        if (i < 0 || i >= this.length)
          throw new RangeError('Index out of bounds');
        return mapFn(ranges.start(i));
      },
      end(i) {
        if (i < 0 || i >= this.length)
          throw new RangeError('Index out of bounds');
        return mapFn(ranges.end(i));
      }
    };
  }
}
