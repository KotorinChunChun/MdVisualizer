import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// 更新日時ではなく内容を使う。追加・削除・出力の破損も無効化する。
export function fingerprint(root, entries, excluded = []) {
  const records = [];
  function visit(relative) {
    const normalized = relative.replaceAll('\\', '/');
    if (excluded.some(value => normalized === value || normalized.startsWith(`${value}/`))) return;
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(path.resolve(root) + path.sep)) throw new Error('キャッシュ入力はworkspace内に限定します。');
    if (!fs.existsSync(filename)) { records.push([normalized, 'missing']); return; }
    const info = fs.lstatSync(filename);
    if (info.isSymbolicLink()) { records.push([normalized, 'link', fs.readlinkSync(filename)]); return; }
    if (info.isDirectory()) {
      records.push([normalized, 'directory']);
      for (const name of fs.readdirSync(filename).sort()) visit(path.join(relative, name));
    } else records.push([normalized, digest(fs.readFileSync(filename))]);
  }
  for (const entry of [...entries].sort()) visit(entry);
  return digest(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, records }));
}

export async function cachedTask({ root, name, inputs, outputs = [], excluded = [], run, force = false }) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('キャッシュ名が不正です。');
  const started = performance.now();
  const directory = path.join(root, '.tools/validation-cache');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `${name}.json`);
  const lock = `${filename}.lock`;
  if (fs.existsSync(lock)) throw new Error(`EEXIST: ${name}のロックがあります。所有プロセスを確認してください。`);
  const inputHash = fingerprint(root, inputs, excluded);
  let previous;
  try { previous = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { /* 初回または破損 */ }
  const outputHash = fingerprint(root, outputs);
  if (!force && previous?.schema === 1 && previous.inputHash === inputHash && previous.outputHash === outputHash
      && outputs.every(value => fs.existsSync(path.join(root, value)))) {
    return { name, status: 'cached', durationMs: Math.round(performance.now() - started), verifiedAt: previous.verifiedAt };
  }
  // 同じ工程の同時実行は待機/強制削除せず止める。
  const fd = fs.openSync(lock, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.rmSync(filename, { force: true });
    await run();
    if (fingerprint(root, inputs, excluded) !== inputHash) throw new Error(`${name}: 実行中に入力が変わりました。再実行してください。`);
    if (!outputs.every(value => fs.existsSync(path.join(root, value)))) throw new Error(`${name}: 必須出力がありません。`);
    const verifiedAt = new Date().toISOString();
    const next = { schema: 1, inputHash, outputHash: fingerprint(root, outputs), verifiedAt };
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next));
    fs.renameSync(temporary, filename);
    return { name, status: 'passed', durationMs: Math.round(performance.now() - started), verifiedAt };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
