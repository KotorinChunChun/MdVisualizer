import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = require.resolve('typescript/bin/tsc');

for (const config of ['tsconfig.esm.json', 'tsconfig.cjs.json']) {
  const result = spawnSync(process.execPath, [tsc, '-p', config], {
    cwd: packageRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const cjsRoot = resolve(packageRoot, 'lib/cjs');
mkdirSync(cjsRoot, { recursive: true });
writeFileSync(resolve(cjsRoot, 'package.json'), '{"type":"commonjs"}\n', 'utf8');
