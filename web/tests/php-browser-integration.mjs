import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import { chromium } from "playwright-core";

const projectRoot = resolve(".");
const php = resolve(".tools/php82/php.exe");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = resolve(`dev/history/v0.0.18/logs/${runId}`);
const storage = resolve(outputRoot, "storage");
const sessions = resolve(outputRoot, "sessions");
const config = resolve(outputRoot, "config.json");
const fixturePath = resolve(outputRoot, "browser-fixture.zip");
const reportPath = resolve(outputRoot, "browser-report.json");
const screenshotPath = resolve(outputRoot, "browser-restored.png");
const serverLog = resolve(outputRoot, "php-server.log");
const password = "browser-http-flow-password";
const originalMarkdown = "# ブラウザーHTTP確認\r\n\r\n画像: ![テスト画像](../images/picture.png)\r\n";
const changedMarkdown = "# 保管後の変更\r\n\r\nこの変更は復号取得で元に戻る必要があります。\r\n";
const imageBytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

const owner = (provider, issuer, sub) => createHash("sha256").update(`${provider}\0${issuer}\0${sub}`).digest("hex");
const ownerId = owner("google", "accounts.google.com", "browser-http-user");
const csrf = "c".repeat(64);
const sessionId = "browser-http-test-session";

let server;
let browser;
let serverChunks = [];
const report = { runId, browser: "", fixturePath, screenshotPath, checks: [], errors: [] };

function pass(label, details = undefined) {
  report.checks.push({ label, ...(details ? { details } : {}) });
  console.log(`PASS: ${label}`);
}

function seedSession() {
  const code = '$save=$argv[1];$id=$argv[2];$csrf=$argv[3];$owner=$argv[4];session_save_path($save);session_name("mdvisualizer_session");session_id($id);session_start();$_SESSION=["csrf"=>$csrf,"user"=>["owner"=>$owner,"provider"=>"google","name"=>"Browser HTTP User","expires"=>time()+3600]];session_write_close();';
  const result = spawnSync(php, ["-d", "extension_dir=.tools/php82/ext", "-r", code, sessions, sessionId, csrf, ownerId], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`session seed failed: ${result.stderr}`);
}

async function createFixture() {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("docs/note.md", new Uint8ArrayReader(new TextEncoder().encode(originalMarkdown)));
  await writer.add("images/picture.png", new Uint8ArrayReader(imageBytes));
  const archive = new Uint8Array(await (await writer.close()).arrayBuffer());
  await writeFile(fixturePath, archive);
  return archive;
}

async function waitForServer(base) {
  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(`${base}/php/api.php?action=session`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("PHP development server did not start");
}

async function readDraftStrings(page) {
  return page.evaluate(() => new Promise((resolveDraft, rejectDraft) => {
    const request = indexedDB.open("mdvisualizer-web-v2", 1);
    request.onerror = () => rejectDraft(request.error ?? new Error("IndexedDB open failed"));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("drafts", "readonly");
      const get = transaction.objectStore("drafts").get("current");
      get.onerror = () => rejectDraft(get.error ?? new Error("IndexedDB read failed"));
      get.onsuccess = () => {
        const values = [];
        const visit = (value) => {
          if (typeof value === "string") values.push(value);
          else if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === "object" && !(value instanceof Blob)) Object.values(value).forEach(visit);
        };
        visit(get.result);
        database.close();
        resolveDraft(values);
      };
    };
  }));
}

function containsBytes(bytes, needle) {
  for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
    let found = true;
    for (let index = 0; index < needle.length; index += 1) if (bytes[offset + index] !== needle[index]) { found = false; break; }
    if (found) return true;
  }
  return false;
}

async function inspectStorageArchive() {
  const userDirectory = resolve(storage, ownerId);
  const names = (await readdir(userDirectory)).filter((name) => name.endsWith(".zip"));
  assert.equal(names.length, 1, "storage has exactly one uploaded ZIP");
  const archivePath = resolve(userDirectory, names[0]);
  const bytes = new Uint8Array(await readFile(archivePath));
  const passwordBytes = new Uint8Array(Buffer.from(password, "utf8"));
  const markdownBytes = new Uint8Array(Buffer.from(originalMarkdown, "utf8"));
  assert(!containsBytes(bytes, passwordBytes), "stored ZIP does not contain the password bytes");
  assert(!containsBytes(bytes, markdownBytes), "stored ZIP does not contain plaintext Markdown");
  const hasAesEntry = [...bytes.keys()].some((offset) => bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04 && bytes[offset + 8] === 99);
  assert(hasAesEntry, "stored ZIP contains an AES method 99 local entry");
  const metadataPath = archivePath.replace(/\.zip$/i, ".json");
  const metadata = await readFile(metadataPath, "utf8");
  assert(!metadata.includes(password), "storage metadata does not contain the password");
  pass("PHP storage contains an AES encrypted ZIP without password or plaintext", { bytes: bytes.byteLength, metadataBytes: Buffer.byteLength(metadata) });
  return { archivePath, bytes };
}

async function main() {
  await mkdir(storage, { recursive: true });
  await mkdir(sessions, { recursive: true });
  await access(resolve("web/php/index.php"));
  const appStats = await stat(resolve("web/php/app.html"));
  if (appStats.size < 100_000) throw new Error("web/php/app.html is not the completed WebApp build; build it before running this browser test");
  await writeFile(config, JSON.stringify({ storage_dir: storage, max_items_per_user: 20, max_bytes_per_user: 100 * 1024 * 1024, max_bytes_total: 1024 * 1024 * 1024, callback_url: "https://example.invalid/php/api.php?action=callback", providers: { google: { client_id: "test-only", client_secret: "test-only" }, microsoft: { client_id: "test-only", client_secret: "test-only" } } }));
  seedSession();
  const fixtureBytes = await createFixture();
  const port = 19789 + Math.floor(Math.random() * 1000);
  server = spawn(php, ["-d", "extension_dir=.tools/php82/ext", "-d", "extension=curl", "-d", "extension=mbstring", "-d", `session.save_path=${sessions}`, "-S", `127.0.0.1:${port}`, "-t", "web"], { cwd: projectRoot, env: { ...process.env, MDVISUALIZER_CONFIG: config }, stdio: ["ignore", "ignore", "pipe"] });
  server.stderr.on("data", (chunk) => serverChunks.push(chunk));
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);
  pass("PHP development server is reachable", { base });

  browser = await chromium.launch({ channel: process.env.MDVISUALIZER_BROWSER_CHANNEL || "msedge", headless: true });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "ja-JP", timezoneId: "Asia/Tokyo", serviceWorkers: "block" });
  await context.addCookies([{ name: "mdvisualizer_session", value: sessionId, domain: "127.0.0.1", path: "/", httpOnly: false, secure: false }]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("requestfailed", (request) => pageErrors.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  let promptCount = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") { promptCount += 1; await dialog.accept(password); }
    else await dialog.dismiss();
  });
  await page.goto(`${base}/php/index.php`, { waitUntil: "networkidle" });
  try {
    await page.getByText("MdVisualizer Web").first().waitFor();
    await page.locator(".cm-content").waitFor({ timeout: 20_000 });
  } catch (error) {
    report.errors.push(`initial WebApp DOM: ${JSON.stringify({ url: page.url(), body: await page.locator("body").innerText().catch(() => ""), pageErrors })}`);
    throw error;
  }
  pass("seeded session receives the WebApp through web/php/index.php");

  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.locator(".cm-content").filter({ hasText: "ブラウザーHTTP確認" }).waitFor({ timeout: 20_000 });
  const loaded = await page.locator(".cm-content").textContent();
  assert(loaded?.includes("ブラウザーHTTP確認"), "fixture Markdown was opened in the editor");
  await page.locator('article img[alt="テスト画像"]').waitFor({ timeout: 20_000 });
  pass("ZIP fixture opens in the editor and restores the image asset");

  await page.getByRole("button", { name: "現在の文書と画像を一時保管" }).click();
  await page.getByRole("button", { name: "復号して開く" }).waitFor({ timeout: 20_000 });
  assert.equal(promptCount, 1, "store asks for a password exactly once");
  pass("WebApp explicitly uploads the encrypted ZIP through the PHP API");
  await inspectStorageArchive();

  await page.locator(".cm-content").click();
  await page.locator(".cm-content").fill(changedMarkdown);
  await page.locator(".cm-content").filter({ hasText: "保管後の変更" }).waitFor();
  await page.waitForTimeout(1000);
  const draftStrings = await readDraftStrings(page);
  assert(!draftStrings.some((value) => value.includes(password)), "IndexedDB draft does not contain the password");
  pass("IndexedDB draft contains no remote-storage password");

  await page.getByRole("button", { name: "復号して開く" }).click();
  await page.locator(".cm-content").filter({ hasText: "ブラウザーHTTP確認" }).waitFor({ timeout: 20_000 });
  assert.equal(promptCount, 2, "download asks for the password exactly once");
  assert(!(await page.locator(".cm-content").textContent()).includes("保管後の変更"), "downloaded document replaced the edited document");
  await page.locator('article img[alt="テスト画像"]').waitFor({ timeout: 20_000 });
  const restoredImageBytes = await page.locator('article img[alt="テスト画像"]').evaluate(async (image) => Array.from(new Uint8Array(await fetch(image.src).then((response) => response.arrayBuffer()))));
  assert.deepEqual(restoredImageBytes, Array.from(imageBytes), "downloaded image bytes match the fixture");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  pass("downloaded ZIP decrypts in the browser and restores Markdown plus image");
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  pass("browser page completed without page errors or failed requests");
  await context.close();

  assert.equal((await readFile(fixturePath)).byteLength, fixtureBytes.byteLength);
}

try {
  await main();
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  await writeFile(serverLog, Buffer.concat(serverChunks)).catch(() => {});
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8").catch(() => {});
  await rm(storage, { recursive: true, force: true }).catch(() => {});
  await rm(sessions, { recursive: true, force: true }).catch(() => {});
}

console.log(`Browser PHP integration passed: ${report.checks.length} checks; report=${reportPath}`);
