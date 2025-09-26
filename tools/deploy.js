import { spawnSync } from 'node:child_process';
import { normalize } from 'node:path';

import pkgJson from '../package.json' with { type: 'json' };

process.exit(
  spawnSync(
    normalize('./node_modules/.bin/ares-install'),
    [normalize(`./youtube.leanback.v4_${pkgJson.version}_all.ipk`)],
    { stdio: 'inherit', shell: true }
  ).status ?? 0
);
