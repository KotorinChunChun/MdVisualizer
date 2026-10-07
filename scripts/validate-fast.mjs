import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cachedTask } from './validation-cache.mjs';
import { takeVersionArgument, versionLogDirectory } from './version-log-path.mjs';

const root = path.resolve(import.meta.dirname, '..');
const { version, args } = takeVersionArgument(process.argv.slice(2));
process.env.MDVISUALIZER_VERSION = version;
const force = args.includes('--force');
const typecheck = args.includes('--typecheck');
const relatedIndex = args.indexOf('--related');
const related = relatedIndex < 0 ? [] : args.slice(relatedIndex + 1);
const allowed = new Set(['--force', '--typecheck', '--related']);
for (const arg of (relatedIndex < 0 ? args : args.slice(0, relatedIndex))) if (!allowed.has(arg)) throw new Error(`不明な引数: ${arg}`);
if (relatedIndex >= 0 && !related.length) throw new Error('--related の後に変更したソースを指定してください。');
const output = versionLogDirectory(root, 'fast-validation', version);
const runId = path.basename(output);
fs.mkdirSync(output, { recursive: true });
const results = [];
const inputs = ['scripts', 'config', 'src', 'docs/developer/ui', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'vitest.config.ts',
  'node_modules/.package-lock.json', 'web-platform/package.json', 'web-platform/package-lock.json', 'web-platform/node_modules/.package-lock.json',
  'web-platform/scripts', 'web-platform/targets.json', 'web-platform/packages/editor-ui/source-map.json', 'web-platform/packages/editor-ui/src',
  'web-platform/apps/web/src', 'web-platform/apps/spfx/src', 'web-platform/packages/markdown-core/src', 'web-platform/tools/mermaid-editor'];
const excluded = ['scripts/__pycache__', 'web-platform/scripts/__pycache__', 'web-platform/tools/mermaid-editor/vendor'];
function execute(script, parameters = [], name = 'command') {
  const log = fs.openSync(path.join(output, `${name}.log`), 'w');
  try {
    const result = spawnSync(process.execPath, [script, ...parameters], { cwd: root, stdio: ['ignore', log, log], timeout: 600_000, env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${name}: 終了コード ${result.status}。${output} のログを確認してください。`);
  } finally { fs.closeSync(log); }
}
async function stage(name, script, parameters = [], cache = true) {
  const start = performance.now();
  try {
    const result = cache ? await cachedTask({ root, name, inputs, excluded, force, run: () => execute(script, parameters, name) })
      : (execute(script, parameters, name), { name, status: 'passed', durationMs: Math.round(performance.now() - start) });
    results.push(result); console.log(`${result.status.padEnd(6)} ${name}: ${result.durationMs} ms`);
  } catch (error) { results.push({ name, status: 'failed', durationMs: Math.round(performance.now() - start), error: String(error) }); throw error; }
}
try {
  await stage('fast-shared', 'scripts/sync-desktop-shared.mjs', ['--check']);
  await stage('fast-command-inventory', 'scripts/ui-command-contract.mjs');
  await stage('fast-command-semantics', 'scripts/check-block-command-semantics.mjs');
  await stage('fast-command-self-test', 'scripts/test-block-command-semantics.mjs');
  await stage('fast-design', 'web-platform/scripts/check-ui-styles.mjs');
  if (typecheck || related.length) {
    await stage('fast-embedded', 'scripts/build-embedded-tools.mjs', [], false);
    // tsc自身の増分情報を使い、成功扱いの独自キャッシュでは省略しない。
    await stage('fast-types', 'node_modules/typescript/bin/tsc', ['--noEmit', '--incremental', '--tsBuildInfoFile', '.tools/validation-cache/types.tsbuildinfo'], false);
  }
  if (related.length) {
    const mapped = related.map(value => {
      const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^web-platform\/packages\/editor-ui\/src\//, 'src/');
      if (!normalized.startsWith('src/') || normalized.includes('..') || !fs.existsSync(path.join(root, normalized))) throw new Error(`--related は存在するsrcファイルを指定してください: ${value}`);
      return normalized;
    });
    await stage('fast-related', 'node_modules/vitest/vitest.mjs', ['related', ...mapped, '--run', '--reporter=json', `--outputFile=${path.join(output, 'vitest.json')}`], false);
  }
} catch (error) { console.error(String(error)); process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ version, runId, results }, null, 2));
  console.log(`検証記録: ${path.relative(root, output)}`);
}
