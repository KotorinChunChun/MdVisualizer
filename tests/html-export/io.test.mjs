import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { boundedFile, createAssetReader, decodeText, fetchBytes, saveHtml } from '../../scripts/html-export/io.mjs';

async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'mdvisualizer-html-test-'));
  t.after(async () => {
    assert.equal(path.dirname(folder), tmpdir());
    assert.ok(path.basename(folder).startsWith('mdvisualizer-html-test-'));
    await rm(folder, { recursive: true, force: true });
  });
  return folder;
}

test('文字コードを判定し、不正なUTF-8を拒否する', () => {
  assert.equal(decodeText(Buffer.from('\ufeff日本語')), '日本語');
  assert.equal(decodeText(Buffer.concat([Buffer.from([255, 254]), Buffer.from('日本語', 'utf16le')])), '日本語');
  assert.throws(() => decodeText(Buffer.from([255, 255])));
});
test('ファイルの容量上限を読む途中でも検査する', async t => {
  const dir = await fixture(t), file = path.join(dir, 'a.txt');
  await writeFile(file, '123456789');
  await assert.rejects(boundedFile(file, 8), /容量/);
  assert.equal((await boundedFile(file, 9)).toString(), '123456789');
});
test('参照元基準で画像を読み込み、Data URLへ格納する', async t => {
  const dir = await fixture(t); await mkdir(path.join(dir, '画像'));
  const file = path.join(dir, '画像', '図.svg'); await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const reader = createAssetReader({ baseDir: dir });
  const asset = await reader.read('%E7%94%BB%E5%83%8F/%E5%9B%B3.svg');
  assert.equal(asset.mime, 'image/svg+xml'); assert.match(asset.data, /^data:image\/svg\+xml;base64,/);
  assert.ok(reader.protectedPaths.has((await realpath(file)).toLowerCase()));
});
test('資産の非対応プロトコル・不正Base64・未許可ネット取得を拒否する', async () => {
  const reader = createAssetReader({ baseDir: process.cwd() });
  await assert.rejects(reader.read('javascript:alert(1)'), /非対応/);
  await assert.rejects(reader.read('data:image/png;base64,%%%%'), /Base64/);
  await assert.rejects(reader.read('https://example.invalid/image.png'), /allow-remote/);
});
test('新規保存と上書き明示を分離し、入力保護を維持する', async t => {
  const dir = await fixture(t), file = path.join(dir, 'out.html');
  await saveHtml(file, '<p>one</p>');
  await assert.rejects(saveHtml(file, '<p>two</p>'), /force/);
  assert.equal(await readFile(file, 'utf8'), '<p>one</p>');
  await saveHtml(file, '<p>two</p>', { force: true });
  await assert.rejects(saveHtml(file, 'bad', { force: true, protectedPaths: new Set([(await realpath(file)).toLowerCase()]) }), /上書きできません/);
  assert.equal(await readFile(file, 'utf8'), '<p>two</p>');
  assert.deepEqual(await readdir(dir), ['out.html']);
});
test('キャンセルと拡張子エラーでは既存ファイルを変更しない', async t => {
  const dir = await fixture(t), file = path.join(dir, 'out.html'); await writeFile(file, 'before');
  await assert.rejects(saveHtml(file, 'after', { force: true, signal: AbortSignal.abort() }));
  await assert.rejects(saveHtml(path.join(dir, 'source.md'), 'bad'), /拡張子/);
  assert.equal(await readFile(file, 'utf8'), 'before');
});
test('同時の新規出力で既存ファイルを上書きしない', async t => {
  const dir = await fixture(t), file = path.join(dir, 'out.html');
  const results = await Promise.allSettled([saveHtml(file, 'A'), saveHtml(file, 'B')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(['A', 'B'].includes(await readFile(file, 'utf8')));
  assert.deepEqual(await readdir(dir), ['out.html']);
});
test('転送・取得容量・認証情報入りURLを検証する', async t => {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { location: '/image' }); response.end(); }
    else if (request.url === '/loop') { response.writeHead(302, { location: '/loop' }); response.end(); }
    else { response.writeHead(200, { 'content-type': 'image/png' }); response.end('123456789'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetchBytes(`${origin}/redirect`)).bytes.toString(), '123456789');
  await assert.rejects(fetchBytes(`${origin}/image`, { maximum: 4 }), /容量/);
  await assert.rejects(fetchBytes(`${origin}/loop`), /転送回数/);
  await assert.rejects(fetchBytes(origin.replace('http://', 'http://user:secret@')), /許可されない/);
});
