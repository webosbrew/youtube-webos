import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_SPEEDS,
  isSupportedSpeed,
  SpeedTimeMap
} from '../../src/speed/timemap.js';

describe('timemap.js', () => {
  test('SUPPORTED_SPEEDS and isSupportedSpeed', () => {
    assert.deepEqual(
      SUPPORTED_SPEEDS,
      [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
    );
    assert.equal(isSupportedSpeed(1.5), true);
    assert.equal(isSupportedSpeed(3), false);
    assert.equal(isSupportedSpeed(0), false);
  });

  test('SpeedTimeMap', () => {
    const map = new SpeedTimeMap(1.5);
    assert.equal(map.speed, 1.5);
    assert.equal(map.toElement(3), 2);
    assert.equal(map.toContent(2), 3);

    map.speed = 2;
    assert.equal(map.speed, 2);
    assert.equal(map.toElement(4), 2);
    assert.equal(map.toContent(2), 4);

    assert.throws(() => {
      map.speed = 3;
    }, TypeError);
  });

  test('mapRanges', () => {
    const map = new SpeedTimeMap(2);
    const ranges = {
      length: 2,
      start(i) {
        if (i < 0 || i >= this.length)
          throw new RangeError('Index out of bounds');
        return i === 0 ? 0 : 10;
      },
      end(i) {
        if (i < 0 || i >= this.length)
          throw new RangeError('Index out of bounds');
        return i === 0 ? 5 : 15;
      }
    };

    const mapped = map.mapRanges(ranges, 'toElement');
    assert.equal(mapped.length, 2);
    assert.equal(mapped.start(0), 0);
    assert.equal(mapped.end(0), 2.5);
    assert.equal(mapped.start(1), 5);
    assert.equal(mapped.end(1), 7.5);

    assert.throws(() => mapped.start(2), RangeError);
    assert.throws(() => mapped.end(-1), RangeError);
  });
});
