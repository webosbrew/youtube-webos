function globForCode(/** @type {string} */ toolName) {
  return '*.?(c|m){js,ts}?(x)' + `*(${toolName})`;
}

/** @type {import('lint-staged').Configuration} */
export default {
  '*': 'prettier --ignore-unknown --write',
  [globForCode('eslint')]: 'eslint',
  [globForCode('tsc')]: () => 'tsc -b'
};
