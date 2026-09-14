import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ZipWriter, BlobWriter, TextReader, Uint8ArrayReader } from "@zip.js/zip.js";
import { chromium } from "playwright-core";

const root = resolve(".");
const out = resolve("dev/history/v0.0.18/logs/mobile-commands"); await mkdir(out, { recursive: true }); const metrics = [];
const appPath = resolve(root, "web/php/app.html");
const viewports = [{ width: 390, height: 844 }, { width: 390, height: 600 }, { width: 320, height: 568 }, { width: 1280, height: 844 }];
const menuLabels = ["開く", "保存", "HTML出力", "Diff", "プレゼン", "印刷"];
const toolbarLabels = ["見出し", "太字", "斜体", "取り消し線", "引用", "箇条書き", "番号付きリスト", "チェックリスト", "リンク", "インラインコード", "コードブロック", "表を挿入", "水平線", "Mermaid図を挿入", "draw.io図を挿入", "SVGを挿入", "画像を挿入", "折畳", "展開", "保存"];

let signedIn = true;
let items = [];
let zipBytes = Buffer.alloc(0);
const server = http.createServer(async (request, response) => {
  if (request.url?.startsWith("/api.php?action=session")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ user: signedIn ? { name: "Mobile Test", provider: "google" } : null, csrf: "c".repeat(64), providers: ["google"], storageAvailable: true }));
    return;
  }
  if (request.url?.startsWith("/api.php?action=list")) {
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ items })); return;
  }
  if (request.url?.startsWith("/api.php?action=logout")) {
    signedIn = false; response.setHeader("Content-Type", "application/json"); response.end("{}"); return;
  }
  if (request.url?.startsWith("/api.php?action=store")) {
    const chunks = []; await new Promise((done) => request.on("data", chunk => chunks.push(chunk)).on("end", done)); zipBytes = Buffer.concat(chunks);
    items = [{ id: "mobile-item", name: "mobile.zip", expires: Math.floor(Date.now() / 1000) + 86400, bytes: 128 }];
    response.setHeader("Content-Type", "application/json"); response.end("{}"); return;
  }
  if (request.url?.startsWith("/api.php?action=delete")) {
    items = []; response.setHeader("Content-Type", "application/json"); response.end("{}"); return;
  }
  if (request.url?.startsWith("/api.php?action=download")) {
    response.setHeader("Content-Type", "application/zip"); response.end(zipBytes); return;
  }
  if (request.url === "/app.html" || request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(await readFile(appPath)); return;
  }
  response.statusCode = 404; response.end("not found");
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: process.env.MDVISUALIZER_BROWSER_CHANNEL || "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP", hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
try {
  const markdown = "# モバイルコマンド確認\n\n本文\n";
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("note.md", new TextReader(markdown));
  await writer.add("images/pixel.png", new Uint8ArrayReader(Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))));
  zipBytes = Buffer.from(await (await writer.close()).arrayBuffer());

  await page.goto(`${base}/app.html`, { waitUntil: "domcontentloaded" });
  await page.locator(".web-app").waitFor();
  page.on("dialog", async (dialog) => { if (dialog.type() === "prompt") await dialog.accept("mobile-password"); else await dialog.accept(); });
  assert.equal(await page.locator(".web-view-selector select").inputValue(), "preview", "初期表示はプレビュー");

  const visible = async (locator, label) => { await locator.waitFor({ state: "visible" }); assert.equal(await locator.isVisible(), true, label); return locator; };
  await visible(page.locator(".web-app-menu > summary"), "メニューsummaryが表示される");
  await page.locator(".web-app-menu > summary").click();
  for (const label of menuLabels) await visible(page.getByRole("button", { name: label, exact: true }), `メニュー: ${label}`);
  await page.locator(".web-app-menu > summary").click();
  await page.locator(".web-options > summary").click();
  await visible(page.locator(".web-options-items select"), "オプション: 文字コード");
  await visible(page.getByRole("checkbox", { name: /BOM/ }), "オプション: BOM");
  await visible(page.getByRole("button", { name: "検索", exact: true }), "オプション: 検索");
  await visible(page.getByRole("button", { name: "下書きを削除", exact: true }), "オプション: 下書きを削除");
  await page.locator(".web-options").evaluate((node) => { node.open = false; });
  await page.locator(".web-app-menu").evaluate((node) => { node.open = false; });

  await page.locator('.web-view-selector select').selectOption("source");
  await page.locator('.markdown-editor__toolbar-details > summary').click();
  const toolbar = page.locator('.markdown-editor__toolbar');
  const actualToolbar = await toolbar.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") || button.textContent?.trim()));
  assert.deepEqual(actualToolbar, toolbarLabels, "Markdownツールバーの20操作がすべて存在する");
  assert.equal(await toolbar.getByRole("button", { name: "展開", exact: true }).getAttribute("title"), "すべて展開", "展開操作のtitle");
  assert.equal(await page.locator('[data-mobile-toolbar="overflow"]').count(), 0, "現行に未定義のoverflowを要求しない");

  await page.locator('input[type="file"]').setInputFiles({ name: "mobile.zip", mimeType: "application/zip", buffer: zipBytes });
  await page.locator('.cm-content').filter({ hasText: "モバイルコマンド確認" }).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".web-app-menu > summary").click();

  await visible(page.getByRole("button", { name: "本文のみ保存", exact: true }), "ZIP条件: 本文のみ保存");
  await visible(page.getByRole("button", { name: "ZIPを保存", exact: true }), "ZIP条件: ZIPを保存");
  await page.locator(".web-app-menu").evaluate((node) => { node.open = false; });

  await page.locator('.web-remote-storage > summary').click();
  await visible(page.getByRole("button", { name: "現在の文書と画像を一時保管", exact: true }), "PHP保管ボタン");
  await visible(page.getByRole("button", { name: "サインアウト", exact: true }), "PHPサインアウト");
  await page.getByRole("button", { name: "サインアウト", exact: true }).click();
  await visible(page.getByRole("link", { name: "Googleでサインイン", exact: true }), "PHPサインアウト後のサインイン");
  signedIn = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('.web-remote-storage > summary').click();
  await page.getByRole("button", { name: "現在の文書と画像を一時保管", exact: true }).click();
  await visible(page.getByRole("button", { name: "復号して開く", exact: true }), "PHP保管一覧");
  await page.getByRole("button", { name: "復号して開く", exact: true }).click();
  await visible(page.getByRole("button", { name: "削除", exact: true }), "PHP復号後の削除");
  await page.getByRole("button", { name: "削除", exact: true }).click();

  await page.locator(".web-remote-storage > summary").click();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.locator('.web-view-selector select').selectOption("source");
    const editorRect = await page.locator('.web-app .markdown-editor').boundingBox();
    assert(editorRect && editorRect.height > 0, `${viewport.width}x${viewport.height}: source editor visible`);
    const sourceMetrics = await page.locator('.web-app').evaluate((node) => ({ rect: node.getBoundingClientRect().toJSON(), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    assert(sourceMetrics.rect.bottom <= viewport.height + 1, `${viewport.width}x${viewport.height}: source bottom=${sourceMetrics.rect.bottom}`);
    assert(sourceMetrics.scrollWidth <= sourceMetrics.clientWidth + 1, `${viewport.width}x${viewport.height}: source horizontal overflow`);
    const cmRect = await page.locator('.web-editor-pane .cm-editor').boundingBox();
    const paneRect = await page.locator('.web-editor-pane').boundingBox();
    assert(cmRect && paneRect && Math.abs(cmRect.y + cmRect.height - paneRect.y - paneRect.height) < 3, 'コード欄がペイン下端まで伸びる');
    assert(cmRect.height > viewport.height * .4, '閉じたツールバーでコード欄が画面高の40%以上');
    metrics.push({ viewport, editor: editorRect, code: cmRect });
    await page.screenshot({ path: resolve(out, `source-${viewport.width}-${viewport.height}.png`) });
    await page.locator('.web-view-selector select').selectOption("preview");
    assert.equal(await page.locator('article.markdown-body').isVisible(), true, `${viewport.width}x${viewport.height}: preview visible`);
  }
  assert.deepEqual(errors, [], errors.join("\n"));
  await writeFile(resolve(out, "result.json"), JSON.stringify({ status: "PASS", toolbarLabels, menuLabels, metrics, errors }, null, 2));
  console.log(`PASS: mobile command inventory (${viewports.length} viewports, ${toolbarLabels.length} toolbar labels)`);
} finally {
  await context.close(); await browser.close(); await new Promise((resolveClose) => server.close(resolveClose));
}
