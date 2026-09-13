import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

const php = resolve(".tools/php82/php.exe");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const root = resolve(`dev/history/v0.0.18/logs/${runId}`);
const storage = resolve(root, "storage");
const sessions = resolve(root, "sessions");
const config = resolve(root, "config.json");
await mkdir(storage, { recursive: true });
await mkdir(sessions, { recursive: true });
await writeFile(config, JSON.stringify({ storage_dir: storage, max_items_per_user: 1, max_bytes_per_user: 100 * 1024 * 1024, max_bytes_total: 1024 * 1024 * 1024 }));

const owner = (provider, issuer, sub) => createHash("sha256").update(`${provider}\0${issuer}\0${sub}`).digest("hex");
const userAOwner = owner("google", "accounts.google.com", "http-user-a");
const userBOwner = owner("google", "accounts.google.com", "http-user-b");
const csrfA = "a".repeat(64);
const csrfB = "b".repeat(64);
const sessionIdA = "http-test-session-a";
const sessionIdB = "http-test-session-b";

function seedSession(id, csrf, ownerId, name) {
  const code = '$save=$argv[1];$id=$argv[2];$csrf=$argv[3];$owner=$argv[4];$name=$argv[5];session_save_path($save);session_name("mdvisualizer_session");session_id($id);session_start();$_SESSION=["csrf"=>$csrf,"user"=>["owner"=>$owner,"provider"=>"google","name"=>$name,"expires"=>time()+3600]];session_write_close();';
  const result = spawnSync(php, ["-d", "extension_dir=.tools/php82/ext", "-r", code, sessions, id, csrf, ownerId, name], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`session seed failed: ${result.stderr}`);
}
seedSession(sessionIdA, csrfA, userAOwner, "HTTP User A");
seedSession(sessionIdB, csrfB, userBOwner, "HTTP User B");

const port = 18789 + Math.floor(Math.random() * 1000);
const serverLog = resolve(root, "php-server.log");
const server = spawn(php, ["-d", "extension_dir=.tools/php82/ext", "-d", "extension=curl", "-d", "extension=mbstring", "-d", `session.save_path=${sessions}`, "-S", `127.0.0.1:${port}`, "-t", "web"], {
  cwd: process.cwd(),
  env: { ...process.env, MDVISUALIZER_CONFIG: config },
  stdio: ["ignore", "ignore", "pipe"],
});
const serverChunks = [];
server.stderr.on("data", chunk => serverChunks.push(chunk));
const base = `http://127.0.0.1:${port}/php/api.php`;
async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const response = await fetch(`${base}?action=session`); if (response.status === 200) return; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  throw new Error("PHP development server did not start");
}
async function request(url, options = {}, sessionId = null) {
  const headers = new Headers(options.headers ?? {});
  if (sessionId) headers.set("Cookie", `mdvisualizer_session=${sessionId}`);
  return fetch(url, { ...options, headers });
}
async function expectStatus(response, status, label) {
  if (response.status !== status) throw new Error(`${label}: expected ${status}, got ${response.status}: ${await response.text()}`);
  console.log(`PASS: ${label}`);
}
async function encryptedZip() {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("document.md", new TextReader("# encrypted HTTP fixture"), { password: "browser-only", encryptionStrength: 3 });
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

try {
  await waitForServer();
  const anon = await request(`${base}?action=list`);
  await expectStatus(anon, 401, "unauthenticated list is rejected");
  const session = await request(`${base}?action=session`);
  await expectStatus(session, 200, "anonymous session endpoint is available");
  const sessionBody = await session.json();
  if (sessionBody.user !== null) throw new Error("anonymous session unexpectedly has a user");
  const zip = await encryptedZip();
  const missingCsrf = await request(`${base}?action=store`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: zip }, sessionIdA);
  await expectStatus(missingCsrf, 403, "upload without CSRF is rejected");
  const storedResponse = await request(`${base}?action=store`, { method: "POST", headers: { "Content-Type": "application/zip", "X-CSRF-Token": csrfA }, body: zip }, sessionIdA);
  await expectStatus(storedResponse, 201, "encrypted ZIP upload succeeds");
  const stored = await storedResponse.json();
  const id = stored.item.id;
  const listed = await request(`${base}?action=list`, {}, sessionIdA);
  await expectStatus(listed, 200, "owner can list uploaded item");
  if ((await listed.json()).items.length !== 1) throw new Error("owner list does not contain upload");
  const downloaded = await request(`${base}?action=download&id=${encodeURIComponent(id)}`, {}, sessionIdA);
  await expectStatus(downloaded, 200, "owner can download uploaded item");
  if (!Buffer.from(await downloaded.arrayBuffer()).equals(Buffer.from(zip))) throw new Error("downloaded ZIP differs from upload");
  const crossOwner = await request(`${base}?action=download&id=${encodeURIComponent(id)}`, {}, sessionIdB);
  await expectStatus(crossOwner, 404, "different owner cannot download item");
  const metadata = resolve(storage, userAOwner, `${id}.json`);
  const expired = JSON.parse(await readFile(metadata, "utf8"));
  expired.expires = Math.floor(Date.now() / 1000) - 1;
  await writeFile(metadata, JSON.stringify(expired));
  const afterExpiry = await request(`${base}?action=list`, {}, sessionIdA);
  await expectStatus(afterExpiry, 200, "list after expiry succeeds");
  if ((await afterExpiry.json()).items.length !== 0) throw new Error("expired item remains listed");
  const zipAfterExpiry = resolve(storage, userAOwner, `${id}.zip`);
  try { await readFile(zipAfterExpiry); throw new Error("expired ZIP remains on disk"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const second = await request(`${base}?action=store`, { method: "POST", headers: { "Content-Type": "application/zip", "X-CSRF-Token": csrfA }, body: zip }, sessionIdA);
  await expectStatus(second, 201, "owner can upload after expired item cleanup");
  const quota = await request(`${base}?action=store`, { method: "POST", headers: { "Content-Type": "application/zip", "X-CSRF-Token": csrfA }, body: zip }, sessionIdA);
  await expectStatus(quota, 413, "per-user item quota is enforced");
  const secondId = (await second.json()).item.id;
  const deleted = await request(`${base}?action=delete&id=${encodeURIComponent(secondId)}`, { method: "POST", headers: { "X-CSRF-Token": csrfA } }, sessionIdA);
  await expectStatus(deleted, 200, "owner can delete item with CSRF");
  const listedFinal = await request(`${base}?action=list`, {}, sessionIdA);
  await expectStatus(listedFinal, 200, "owner list remains available after delete");
  if ((await listedFinal.json()).items.length !== 0) throw new Error("deleted item remains listed");
} finally {
  server.kill();
  await writeFile(serverLog, Buffer.concat(serverChunks));
  await rm(storage, { recursive: true, force: true });
  await rm(sessions, { recursive: true, force: true });
}
