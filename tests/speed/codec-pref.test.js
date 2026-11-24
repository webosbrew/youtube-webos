import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferNonAv1 } from '../../src/speed/codec-pref.js';

test('AV1 reads as unsupported, other codecs are asked as before, and restore undoes it', () => {
  const asked = [];
  const MediaSource = {
    isTypeSupported(t) {
      asked.push(t);
      return true;
    }
  };
  const win = { MediaSource };
  const restore = preferNonAv1(win);
  assert.equal(
    MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"'),
    false
  );
  assert.equal(MediaSource.isTypeSupported('video/webm; codecs="vp9"'), true);
  assert.deepEqual(asked, ['video/webm; codecs="vp9"']);
  restore();
  assert.equal(
    MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"'),
    true
  );
});

test('no MediaSource: nothing to do', () => {
  preferNonAv1({})();
});
