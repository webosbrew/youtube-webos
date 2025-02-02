import assert from 'node:assert';

import eslintJs from '@eslint/js';
import type { ESLint, Linter } from 'eslint';
import stylistic from '@stylistic/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import * as regexpPlugin from 'eslint-plugin-regexp';
import globals from 'globals';
import pkgJson from './package.json' with { type: 'json' };

const defaultSourceType: Linter.SourceType = 'module';
assert(pkgJson.type === defaultSourceType);

const configs = [
  eslintJs.configs.recommended,
  prettierConfig,
  regexpPlugin.configs['flat/recommended'],

  {
    plugins: {
      // Cast needed due to type mismatch even though this is the recommmended way to use the plugin.
      '@stylistic': stylistic as ESLint.Plugin
    },

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
      'no-useless-computed-key': 'error',
      'no-useless-constructor': 'error',
      'no-useless-return': 'error',
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

      // @stylistic rules - needed as prettier doesn't handle these
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],

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
] as const satisfies Linter.Config[];

export default configs;
