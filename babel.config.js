import Module from 'node:module';

const require = Module.createRequire(import.meta.url);

// From: https://github.com/babel/babel-polyfills/blob/a5db9c31c5b5474b4018e6178bc40882fc3eb5bf/packages/babel-plugin-polyfill-corejs3/README.md#version

const {
  version: babelruntimeVersion
} = require('@babel/runtime-corejs3/package.json');
const { version: corejspureVersion } = require('core-js-pure/package.json');

/** @type {import('@babel/core').ConfigFunction} */
function makeConfig(api) {
  api.cache.invalidate(() => babelruntimeVersion + corejspureVersion);

  return {
    // Fixes "TypeError: __webpack_require__(...) is not a function"
    // https://github.com/webpack/webpack/issues/9379#issuecomment-509628205
    // https://babel.dev/docs/options#sourcetype
    sourceType: 'unambiguous',
    // https://babel.dev/docs/assumptions
    assumptions: {
      noNewArrows: true
    },
    plugins: [
      [
        '@babel/plugin-transform-typescript',
        {
          strictMode: true
        }
      ],
      [
        '@babel/plugin-transform-runtime',
        {
          regenerator: false,
          version: babelruntimeVersion
        }
      ],
      [
        'polyfill-corejs3',
        {
          method: 'usage-pure',
          version: corejspureVersion
        }
      ],
      [
        'polyfill-regenerator',
        {
          method: 'usage-pure'
        }
      ]
    ],
    presets: [
      [
        '@babel/preset-env',
        {
          bugfixes: true
        }
      ]
    ]
  };
}

export default makeConfig;
