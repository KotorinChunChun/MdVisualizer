import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachedTask } from './validation-cache.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-cache-test-'));
let runs = 0;
const write = (name, value) => fs.writeFileSync(path.join(root, name), value);
write('input', 'one');
const task = { root, name: 'fixture', inputs: ['input'], outputs: ['output'], run: () => { runs++; write('output', 'valid'); } };
try {
  assert.equal((await cachedTask(task)).status, 'passed');
  assert.equal((await cachedTask(task)).status, 'cached');
  assert.equal(runs, 1);
  const timestamp = fs.statSync(path.join(root, 'input')).mtime;
  write('input', 'two'); fs.utimesSync(path.join(root, 'input'), timestamp, timestamp);
  assert.equal((await cachedTask(task)).status, 'passed');
  write('output', 'broken'); assert.equal((await cachedTask(task)).status, 'passed');
  fs.unlinkSync(path.join(root, 'output')); assert.equal((await cachedTask(task)).status, 'passed');
  await assert.rejects(cachedTask({ ...task, force: true, run() { throw new Error('failure'); } }));
  assert.equal((await cachedTask(task)).status, 'passed');
  await assert.rejects(cachedTask({ ...task, force: true, run() { write('input', 'changed during run'); } }), /入力が変わり/);
  const lock = path.join(root, '.tools/validation-cache/fixture.json.lock');
  write('input', 'next'); fs.writeFileSync(lock, 'owned by another process');
  await assert.rejects(cachedTask(task), /EEXIST/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'owned by another process');
  fs.unlinkSync(lock);
  console.log('検証キャッシュ: 内容変更・同mtime・出力破損/欠落・失敗・実行中変更・排他 PASS');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
