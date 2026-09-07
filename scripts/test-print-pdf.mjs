import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "tmp/print-pdf", new Date().toISOString().replace(/[:.]/g, "-"));
const harnessRoot = resolve(root, "tests/print-pdf");
const cases = ["normal", "dark", "metadata-off", "fold-current", "fold-all", "long", "presentation", "table"];
const report = { startedAt: new Date().toISOString(), node: process.version, engine: "", mode: "headless", output, cases: [], excluded: ["WebView2 native dialog", "OS spooler / CubePDF"], errors: [] };
let server;
let browser;

async function inspectPdf(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push({ text: content.items.filter((item) => "str" in item).map((item) => item.str).join(" "), width: page.view[2] - page.view[0], height: page.view[3] - page.view[1] });
    }
    return pages;
  } finally { await task.destroy(); }
}

async function withinDeadline(operation, milliseconds = 60_000) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`印刷テストが${milliseconds}msを超過しました`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

try {
  await mkdir(output, { recursive: true });
  await build({ configFile: false, root: harnessRoot, plugins: [react()], logLevel: "warn",
    build: { outDir: resolve(output, "harness"), emptyOutDir: false } });
  server = await preview({ configFile: false, root: harnessRoot, build: { outDir: resolve(output, "harness") },
    preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false } });
  const address = server.httpServer.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  // 新規の隔離プロファイルのみを使い、既存ブラウザーやOS入力を操作しない。
  browser = await chromium.launch({ headless: true,
    ...(process.env.PRINT_PDF_BROWSER_PATH ? { executablePath: process.env.PRINT_PDF_BROWSER_PATH }
      : { channel: process.env.PRINT_PDF_BROWSER_CHANNEL || "msedge" }) });
  report.engine = browser.version();
  for (const name of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1800 }, locale: "ja-JP", timezoneId: "Asia/Tokyo", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      errors.push(`外部通信を拒否: ${route.request().url()}`);
      return route.abort();
    });
    const pdfPath = resolve(output, `${name}.pdf`);
    let generated = false;
    try {
      await page.exposeFunction("createTestPdf", async () => {
        assert(!generated, "PDF出力の二重呼出し");
        if (name === "metadata-off") assert.equal(await page.locator(".print-metadata").count(), 0, "非表示メタデータの罫線が残っています");
        await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
        generated = true;
      });
      await page.goto(`${origin}/?case=${name}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.printTest?.ready());
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      if (["normal", "dark", "metadata-off"].includes(name)) {
        await page.waitForSelector(".mermaid-container svg");
      }
      if (name === "table") {
        await page.evaluate(() => {
          const first = document.querySelector(".data-grid-card");
          const search = first.querySelector('input[type="search"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "KEEP_ROW");
          search.dispatchEvent(new Event("input", { bubbles: true }));
          [...first.querySelectorAll("button")].find((button) => button.textContent === "列表示").click();
        });
        await page.waitForFunction(() => document.querySelectorAll(".data-grid-column-panel input").length === 3);
        await page.evaluate(() => {
          const first = document.querySelector(".data-grid-card");
          first.querySelectorAll(".data-grid-column-panel input")[2].click();
          first.querySelectorAll("thead th button")[1].click();
        });
        await page.evaluate(() => document.querySelector(".data-grid-card").querySelectorAll("thead th button")[1].click());
      }
      await page.evaluate(() => { document.querySelector(".preview-container").scrollTop = 137; });
      const before = await page.evaluate(() => window.printTest.state());
      if (name === "long") assert(before.scrollTop > 0, "スクロール復元の開始位置が設定されていません");
      await withinDeadline(async () => {
        await page.evaluate(() => window.printTest.print());
        await page.waitForFunction(() => !window.printTest.state().printing && !window.printTest.state().tablePrinting);
      });
      assert(generated, "PDFが生成されていません");
      const after = await page.evaluate(() => window.printTest.state());
      assert.equal(after.restoreCount, name === "table" ? 0 : 1);
      assert.equal(after.scrollTop, before.scrollTop);
      assert.equal(after.collapsed, before.collapsed);
      assert.equal(after.startedAt, null);
      assert.equal(after.printHosts, 0);
      assert.deepEqual(after.messages, []);
      assert.deepEqual(errors, []);
      const bytes = await readFile(pdfPath);
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      const pages = await inspectPdf(bytes);
      const text = pages.map((page) => page.text).join("\n").normalize("NFKC");
      assert(!text.includes("PDF_EXCLUDED_"), "操作UIまたは対象外の本文が印刷されました");
      for (const label of ["Copy", "コードをコピー", "ラスタコピー", "ベクタコピー", "CSVコピー", "TSVコピー"]) {
        assert(!text.includes(label), `コンテンツ操作ボタンが印刷されました: ${label}`);
      }
      for (const page of pages) {
        assert(Math.abs(page.width - 595.28) < 2 && Math.abs(page.height - 841.89) < 2, "A4サイズが不一致");
        assert(page.text.trim().length > 0, "空白ページがあります");
      }
      if (name === "presentation") {
        assert.equal(pages.length, 3, "1スライド1ページになっていません");
        ["ONE", "TWO", "THREE"].forEach((token, i) => {
          assert(pages[i].text.includes(`PDF_SLIDE_${token}`));
          assert.equal(pages[i].text.match(/PDF_SLIDE_/g)?.length, 1);
        });
      } else if (name === "table") {
        assert(pages.length > 1, "長表が複数ページへ出力されていません");
        assert(!text.includes("DROP_ROW") && !text.includes("PDF_HIDDEN_COLUMN"));
        const rows = [...text.matchAll(/KEEP_ROW_(\d{3})/g)].map((match) => Number(match[1]));
        assert.deepEqual(rows, Array.from({ length: 60 }, (_, i) => 60 - i), "フィルター・ソート・ページング外行が不一致");
      } else if (name === "long") {
        assert(pages.length > 1);
        const paragraphs = [...text.matchAll(/PDF_PARAGRAPH_(\d{3})/g)].map((match) => Number(match[1]));
        assert.deepEqual(paragraphs, Array.from({ length: 100 }, (_, i) => i + 1));
      } else {
        assert(text.includes("PDF_VISIBLE_TEXT"));
        if (name.startsWith("fold-")) assert.equal(text.includes("PDF_FOLDED_BODY"), name === "fold-all");
        // PDFの文字runは互換漢字の前後で分割されるため、字間空白を除いて照合する。
        else for (const token of ["日本語", "PDF_CODE_TOKEN", "PDF_DIAGRAM_A", "PDF_DIAGRAM_B", "PDF_SVG_TOKEN"]) assert(text.replace(/\s+/gu, "").includes(token), `PDF本文に${token}がありません`);
      }
      if (name !== "table") assert.equal(text.includes("print-fixture.md"), name !== "metadata-off");
      const result = { name, status: "passed", pages: pages.length, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), pdfPath };
      report.cases.push(result);
      console.log(`[印刷PDF] ${name}: ${pages.length}ページ、${bytes.length} bytes、成功`);
    } finally { await context.close(); }
  }
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  await server?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`印刷検証レポート: ${resolve(output, "report.json")}`);
}
