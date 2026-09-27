import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logs = path.join(root, 'dev/history/v0.0.18/logs/web-platform-setup');
await mkdir(logs, { recursive: true });
const fixture = await mkdtemp(path.join(logs, 'fixture-'));
await mkdir(path.join(fixture, 'scripts'));
for (const script of ['setup-web-platform.mjs', 'sync-desktop-shared.mjs']) {
  await copyFile(path.join(root, 'scripts', script), path.join(fixture, 'scripts', script));
}
for (const dir of ['apps/web', 'apps/spfx', 'packages/markdown-core', 'packages/editor-ui/src/components', 'scripts/html-export']) {
  await mkdir(path.join(fixture, 'web-platform', dir), { recursive: true });
}
const source = path.join(fixture, 'web-platform/packages/editor-ui/src/components/example.ts');
const target = path.join(fixture, 'src/components/example.ts');
await writeFile(path.join(fixture, 'web-platform/packages/editor-ui/source-map.json'), JSON.stringify({ files: ['components/example.ts'] }));
await writeFile(source, 'export const value = 1;\n');
function run(script, args = []) {
  return spawnSync(process.execPath, [path.join(fixture, 'scripts', script), ...args], { cwd: fixture, encoding: 'utf8' });
}
assert.equal(run('setup-web-platform.mjs').status, 0, '空のcloneでリンクと投影を生成できる');
assert.equal(run('sync-desktop-shared.mjs', ['--check']).status, 0);
await writeFile(source, 'export const value = 2;\n');
assert.notEqual(run('sync-desktop-shared.mjs', ['--check']).status, 0, '正本更新の未反映を検出');
assert.equal(run('setup-web-platform.mjs').status, 0, '既存リンクを維持して再生成');
assert.equal(await readFile(target, 'utf8'), await readFile(source, 'utf8'));
await writeFile(target, '利用者の手修正\n');
assert.notEqual(run('setup-web-platform.mjs').status, 0, '手修正を上書きしない');
assert.equal(await readFile(target, 'utf8'), '利用者の手修正\n');
await writeFile(path.join(fixture, 'web-platform/packages/editor-ui/source-map.json'), JSON.stringify({ files: ['../../escape.ts'] }));
assert.notEqual(run('sync-desktop-shared.mjs').status, 0, '相対パス逸脱を拒否');
console.log('Web子Gitセットアップ: 新規生成・再生成・差分・手修正保護・パス逸脱の5項目成功');
