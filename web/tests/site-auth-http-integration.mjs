import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

const php = resolve('.tools/php82/php.exe');
const root = resolve(`dev/history/v0.0.18/logs/site-auth-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const storage = resolve(root, 'storage');
const sessions = resolve(root, 'sessions');
const config = resolve(root, 'config.json');
const bootstrap = resolve('web/tests/site-auth-bootstrap.php');
const owner = (sub) => createHash('sha256').update(`google\0accounts.google.com\0${sub}`).digest('hex');
const sessionName = 'site_auth_test';
const sessionId = 'site-auth-http';
const csrf = 'a'.repeat(64);
let server;

function seed(user = 'active-user') {
  const code = '$save=$argv[1];$id=$argv[2];$user=$argv[3];$csrf=$argv[4];session_save_path($save);session_name("site_auth_test");session_id($id);session_start();$_SESSION=["google_user_id"=>$user,"mdv_csrf"=>$csrf,"unrelated_site_state"=>"keep"];session_write_close();';
  const result = spawnSync(php, ['-r', code, sessions, sessionId, user, csrf], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
async function request(url, options = {}, signedIn = false) {
  const headers = new Headers(options.headers ?? {});
  if (signedIn) headers.set('Cookie', `${sessionName}=${sessionId}`);
  return fetch(url, { ...options, headers, redirect: 'manual' });
}
async function encryptedZip() {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('document.md', new TextReader('# shared site auth'), { password: 'browser-only', encryptionStrength: 3 });
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

await mkdir(storage, { recursive: true });
await mkdir(sessions, { recursive: true });
await writeFile(config, JSON.stringify({ storage_dir: storage, max_items_per_user: 2, max_bytes_per_user: 100 * 1024 * 1024, max_bytes_total: 1024 * 1024 * 1024 }));
seed();
const port = 20789 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}/php`;
try {
  server = spawn(php, ['-d', `session.save_path=${sessions}`, '-S', `127.0.0.1:${port}`, '-t', 'web'], { env: { ...process.env, MDVISUALIZER_CONFIG: config, MDVISUALIZER_SITE_AUTH_BOOTSTRAP: bootstrap }, stdio: 'ignore' });
  for (let tries = 0; tries < 40; tries += 1) { try { if ((await fetch(`${base}/api.php?action=session`)).status === 200) break; } catch {} await new Promise((done) => setTimeout(done, 50)); }
  const anonymous = await request(`${base}/index.php`);
  assert.equal(anonymous.status, 200);
  assert.match(await anonymous.text(), /\/auth\/google\/login\.php\?return_to=%2Fphp%2Findex\.php/);
  console.log('PASS: 未認証の入口はサイト共通Googleログインへ案内する');
  const login = await request(`${base}/api.php?action=login&provider=google`);
  assert.equal(login.status, 302); assert.match(login.headers.get('location') ?? '', /^\/auth\/google\/login\.php\?return_to=/);
  console.log('PASS: APIログインはサイト共通ログインへリダイレクトする');
  const session = await request(`${base}/api.php?action=session`, {}, true);
  assert.equal(session.status, 200); const body = await session.json();
  assert.deepEqual(body.user, { name: '共有ログイン利用者', provider: 'google' }); assert.equal(body.loginUrl, '/auth/google/login.php?return_to=%2Fphp%2Findex.php'); assert.equal(body.logoutUrl, '/auth/logout.php?return_to=%2Fphp%2Findex.php'); assert.equal(body.csrf, csrf);
  console.log('PASS: 共有セッションから利用者と分離CSRFを返す');
  const zip = await encryptedZip();
  const stored = await request(`${base}/api.php?action=store`, { method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-CSRF-Token': csrf }, body: zip }, true);
  assert.equal(stored.status, 201); const item = await stored.json();
  assert.match(resolve(storage, owner('shared-active-subject'), `${item.item.id}.zip`), /[a-f0-9]{64}/);
  console.log('PASS: 暗号化ZIPを共有Google subjectの既存所有者キーへ保管する');
  const logout = await request(`${base}/api.php?action=logout`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } }, true);
  assert.equal(logout.status, 409);
  const afterLogout = await request(`${base}/api.php?action=session`, {}, true);
  assert.deepEqual((await afterLogout.json()).user, { name: '共有ログイン利用者', provider: 'google' });
  console.log('PASS: MdVisualizerのログアウト要求は共通サイトのログインを消さない');
  seed('suspended-user');
  const suspended = await request(`${base}/api.php?action=session`, {}, true);
  assert.equal(suspended.status, 403);
  console.log('PASS: 停止中の共有利用者はセッションAPIでも拒否する');
  const source = await Promise.all(['lib.php', 'index.php', 'api.php'].map((file) => readFile(resolve('web/php', file), 'utf8')));
  assert(!source.join('\n').includes("require_once __DIR__ . '/oidc.php'"));
  assert(!source.join('\n').includes('mdv_login('));
  console.log('PASS: 製品入口は独自OIDCを呼び出さない');
} finally {
  server?.kill();
  await rm(storage, { recursive: true, force: true });
  await rm(sessions, { recursive: true, force: true });
}
