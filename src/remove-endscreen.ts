import kindOf from 'which-builtin-type';

import { configRead } from './config';

function isObject(value: unknown): value is object {
  // @ts-expect-error - bad types
  return kindOf(value) === 'Object';
}

type JSONReviver = Parameters<typeof JSON.parse>[1];

const originalParse = JSON.parse;

function jsonParse(str: string, reviver?: JSONReviver) {
  const res = originalParse(str, reviver) as unknown;

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
}

JSON.parse = jsonParse;
