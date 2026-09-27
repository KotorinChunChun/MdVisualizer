import { lstat, realpath, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { symlink } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformRoot = path.join(root, 'web-platform');
const sourceMap = path.join(platformRoot, 'packages', 'editor-ui', 'source-map.json');
const links = [
  { target: path.join(platformRoot, 'apps', 'web'), destination: path.join(root, 'web') },
  { target: path.join(platformRoot, 'apps', 'spfx'), destination: path.join(root, 'spfx') },
  { target: path.join(platformRoot, 'packages', 'markdown-core'), destination: path.join(root, 'packages', 'markdown-core') },
  { target: path.join(platformRoot, 'scripts', 'html-export'), destination: path.join(root, 'scripts', 'html-export') },
];

if (process.argv.length !== 2) throw new Error('引数は指定できません。');

function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function linkState(item) {
  let destinationInfo;
  try { destinationInfo = await lstat(item.destination); }
  catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    throw error;
  }
  if (!destinationInfo.isSymbolicLink()) {
    throw new Error(`既存の実ディレクトリは置換しません: ${item.destination}`);
  }
  const [actual, expected] = await Promise.all([realpath(item.destination), realpath(item.target)]);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`既存リンクの参照先が異なります: ${item.destination}`);
  }
  return 'linked';
}

try { if (!(await stat(platformRoot)).isDirectory()) throw new Error('web-platform がディレクトリではありません。'); }
catch (error) { throw new Error(`web-platform を確認できません: ${error instanceof Error ? error.message : String(error)}`); }
try { if (!(await stat(sourceMap)).isFile()) throw new Error('source-map が通常ファイルではありません。'); }
catch (error) { throw new Error(`先に child の source-map を準備してください: ${error instanceof Error ? error.message : String(error)}`); }
if (!inside(root, await realpath(sourceMap))) throw new Error(`source-map がworkspace外へ解決されます: ${sourceMap}`);

const expected = [];
for (const item of links) {
  let realTarget;
  try { realTarget = await realpath(item.target); }
  catch (error) { throw new Error(`child の必要なディレクトリがありません: ${item.target} (${error instanceof Error ? error.message : String(error)})`); }
  if (!inside(root, realTarget)) throw new Error(`リンク先がworkspace外です: ${item.target}`);
  if (!(await stat(realTarget)).isDirectory()) throw new Error(`リンク先がディレクトリではありません: ${item.target}`);
  expected.push({ ...item, realTarget, state: await linkState(item) });
}

for (const item of expected) {
  if (item.state === 'linked') continue;
  await mkdir(path.dirname(item.destination), { recursive: true });
  await symlink(item.realTarget, item.destination, process.platform === 'win32' ? 'junction' : 'dir');
  const resolved = await realpath(item.destination);
  if (!inside(root, resolved) || resolved.toLowerCase() !== item.realTarget.toLowerCase()) {
    throw new Error(`作成したリンクの検証に失敗しました: ${item.destination}`);
  }
  console.log(`互換リンクを作成しました: ${path.relative(root, item.destination)}`);
}

const sync = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-desktop-shared.mjs')], { cwd: root, stdio: 'inherit' });
if (sync.error) throw sync.error;
if (sync.status !== 0) throw new Error(`desktop共有投影が終了コード ${sync.status} で失敗しました。`);
console.log('web-platform の互換リンクとdesktop共有投影を確認しました。');
