import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';

import eslintJs from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import * as regexpPlugin from 'eslint-plugin-regexp';
import globals from 'globals';

const require = Module.createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {'module' | 'commonjs'} */
const defaultSourceType =
  require(join(__dirname, 'package.json')).type ?? 'commonjs';

/** @type {import('eslint').Linter.Config[]} */
export default [
  eslintJs.configs.recommended,
  prettierConfig,
  regexpPlugin.configs['flat/recommended'],

  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },

    languageOptions: {
      sourceType: defaultSourceType,
      parserOptions: {
        ecmaFeatures: {
          impliedStrict: true
        }
      },
      globals: {
        ...globals.nodeBuiltin
      }
    },

    rules: {
      'no-var': 'error',
      'no-await-in-loop': 'error',
      'no-implicit-globals': ['error'],
      'no-unused-vars': ['error', { vars: 'local', argsIgnorePattern: '^_' }],
      'no-useless-rename': ['error'],
      'arrow-body-style': ['error', 'as-needed'],
      'no-lonely-if': 'error',
      'prefer-object-has-own': 'error',
      'prefer-exponentiation-operator': 'error',
      'prefer-regex-literals': ['error', { disallowRedundantWrapping: true }],
      'array-callback-return': [
        'error',
        { checkForEach: true, allowVoid: true }
      ],
      'no-constructor-return': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-useless-assignment': 'error',

      /* eslint-plugin-regexp */
      'regexp/prefer-character-class': ['error', { minAlternatives: 2 }],
      'regexp/no-empty-alternative': 'error', // Set to warn in recommended config
      'regexp/no-lazy-ends': 'error', // Set to warn in recommended config
      'regexp/no-potentially-useless-backreference': 'error', // Set to warn in recommended config
      'regexp/confusing-quantifier': 'error', // Set to warn in recommended config
      'regexp/no-useless-flag': 'error', // Set to warn in recommended config
      'regexp/optimal-lookaround-quantifier': 'error' // Set to warn in recommended config
    }
  },

  {
    files: ['src/**/*'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },

  {
    // Why doesn't ESLint do this by default is beyond me.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs'
    }
  },

  {
    // Why doesn't ESLint do this by default is beyond me.
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module'
    }
  },

  {
    // `ignores` field must be in the very bottom config.
    ignores: ['dist/**/*', '**/*-polyfill.*']
  }
];
