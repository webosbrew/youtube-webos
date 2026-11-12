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

/**
 * Maps time between element time and content time.
 */
export class SpeedTimeMap {
  /**
   * @param {number} speed
   */
  constructor(speed) {
    this._speed = 1;
    this.speed = speed;
  }

  /**
   * Gets the current speed.
   * @returns {number}
   */
  get speed() {
    return this._speed;
  }

  /**
   * Sets the speed. Throws if unsupported.
   * @param {number} value
   */
  set speed(value) {
    if (!isSupportedSpeed(value)) {
      throw new TypeError(`Unsupported speed: ${value}`);
    }
    this._speed = value;
  }

  /**
   * Converts content time to element time.
   * @param {number} t
   * @returns {number}
   */
  toElement(t) {
    return t / this._speed;
  }

  /**
   * Converts element time to content time.
   * @param {number} t
   * @returns {number}
   */
  toContent(t) {
    return t * this._speed;
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
