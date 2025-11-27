import { configRead } from './config';

function isObject(value) {
  // @ts-expect-error - bad types
  return typeof value === 'object';
}

const origParse = JSON.parse;

JSON.parse = function () {
  const res = origParse.apply(this, arguments);

  if (!configRead('removeEndscreen')) {
    return res;
  }

  if (
    isObject(res) &&
    'endscreen' in res &&
    isObject(res.endscreen) &&
    'endscreenRenderer' in res.endscreen
  ) {
    console.debug('Removed endscreen from JSON response', res.endscreen);
    delete res.endscreen;
  }

  return res;
};
