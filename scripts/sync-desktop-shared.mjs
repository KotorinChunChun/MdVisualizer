import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformRoot = path.join(root, 'web-platform');
const mapPath = path.join(platformRoot, 'packages', 'editor-ui', 'source-map.json');
const statePath = path.join(root, '.tools', 'desktop-shared-projection.json');
const arguments_ = process.argv.slice(2);
if (arguments_.length > 1 || (arguments_.length === 1 && arguments_[0] !== '--check')) {
  throw new Error('使い方: node scripts/sync-desktop-shared.mjs [--check]');
}
const checkOnly = arguments_[0] === '--check';

function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /^[a-z]:/i.test(value)) {
    throw new Error(`source-map の files に不正なパスがあります: ${String(value)}`);
  }
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`source-map の files に親パスまたは空要素があります: ${value}`);
  }
  return parts.join(path.sep);
}

const digest = value => createHash('sha256').update(value).digest('hex');
const fileHash = async file => digest(await readFile(file));

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw new Error(`${file} をJSONとして読めません: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const map = await readJson(mapPath, undefined);
if (!map || !Array.isArray(map.files)) {
  throw new Error(`source-map がありません、または files 配列ではありません: ${mapPath}`);
}
const state = await readJson(statePath, { version: 1, files: {} });
if (!state || typeof state !== 'object' || typeof state.files !== 'object' || Array.isArray(state.files)) {
  throw new Error(`投影状態ファイルが不正です: ${statePath}`);
}

const entries = [];
const seen = new Set();
const sourceRoot = await realpath(path.join(platformRoot, 'packages', 'editor-ui', 'src'));
if (!inside(root, sourceRoot)) throw new Error(`正本ディレクトリがworkspace外です: ${sourceRoot}`);
for (const listed of map.files) {
  const relative = safeRelative(listed);
  if (seen.has(relative)) throw new Error(`source-map に重複したパスがあります: ${listed}`);
  seen.add(relative);
  const source = path.resolve(platformRoot, 'packages', 'editor-ui', 'src', relative);
  const target = path.resolve(root, 'src', relative);
  if (!inside(path.join(platformRoot, 'packages', 'editor-ui', 'src'), source) || !inside(path.join(root, 'src'), target)) {
    throw new Error(`許可範囲外の投影先です: ${listed}`);
  }
  let sourceInfo;
  try { sourceInfo = await lstat(source); } catch { throw new Error(`正本ファイルがありません: ${source}`); }
  if (sourceInfo.isSymbolicLink()) throw new Error(`正本にリンクは使用できません: ${source}`);
  if (!sourceInfo.isFile()) throw new Error(`正本が通常ファイルではありません: ${source}`);
  if (!inside(sourceRoot, await realpath(source))) throw new Error(`正本が許可範囲外へ解決されます: ${source}`);
  entries.push({ relative: listed.replaceAll('\\', '/'), source, target, hash: await fileHash(source) });
}

const pending = [];
for (const entry of entries) {
  let targetHash;
  try {
    const targetInfo = await lstat(entry.target);
    if (targetInfo.isSymbolicLink()) throw new Error(`投影先にリンクは使用できません: ${entry.target}`);
    if (!targetInfo.isFile()) throw new Error(`投影先が通常ファイルではありません: ${entry.target}`);
    targetHash = await fileHash(entry.target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (checkOnly) {
    if (targetHash !== entry.hash) pending.push(entry.relative);
    continue;
  }
  if (targetHash !== undefined && targetHash !== entry.hash) {
    const previousHash = state.files[entry.relative]?.hash;
    if (previousHash !== targetHash) {
      throw new Error(`投影先が手動変更されています。上書きしません: ${entry.target}`);
    }
  }
  pending.push({ ...entry, targetHash });
}

if (checkOnly) {
  if (pending.length) {
    console.error(`desktop共有投影が一致しません: ${pending.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`desktop共有投影は一致しています（${entries.length}ファイル）。`);
  }
} else {
  for (const entry of pending) {
    if (entry.targetHash === entry.hash) continue;
    await mkdir(path.dirname(entry.target), { recursive: true });
    const temporary = `${entry.target}.desktop-shared-${process.pid}.tmp`;
    await writeFile(temporary, await readFile(entry.source));
    await rename(temporary, entry.target);
    console.log(`desktop共有投影を更新しました: src/${entry.relative}`);
  }
  const nextState = { version: 1, files: Object.fromEntries(entries.map(entry => [entry.relative, { hash: entry.hash }])) };
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryState = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryState, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  await rename(temporaryState, statePath);
  console.log(`desktop共有投影を確認しました（${entries.length}ファイル）。`);
}
