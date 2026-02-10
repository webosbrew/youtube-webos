import type { UserConfig } from '@commitlint/types';
import { RuleConfigSeverity } from '@commitlint/types';
import preset from '@commitlint/config-conventional';

const types = [...preset.rules['type-enum'][2]];

if (!process.env.CI) {
  types.push('wip');
}

const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [RuleConfigSeverity.Error, 'always', types]
  }
} satisfies UserConfig;

export default config;
