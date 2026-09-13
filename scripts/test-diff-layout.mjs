import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "tmp/diff-layout", new Date().toISOString().replace(/[:.]/g, "-"));
const harness = resolve(root, "tests/diff-layout");
const report = { startedAt: new Date().toISOString(), node: process.version, engine: "", cases: [], errors: [],
  exclusions: ["実アプリ・WebView2", "OS入力・GUI", "OSファイル通知", "実ファイル保存"] };
let server, browser;

async function settle(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 80)))));
}
async function measure(page, label) {
  await settle(page);
  const sample = await page.evaluate(() => {
    const columns = [...document.querySelectorAll(".diff-code-editor")].map((column) => {
      const scroller = column.querySelector(".cm-scroller");
      const viewport = scroller.getBoundingClientRect();
      const lines = [...column.querySelectorAll(".cm-line[data-diff-row]")].map((line) => {
        const rect = line.getBoundingClientRect(), style = getComputedStyle(line);
        return { id: line.dataset.diffRow, top: rect.top, height: rect.height, text: line.textContent,
          style: [style.fontFamily, style.fontSize, style.lineHeight, style.padding, style.letterSpacing, style.tabSize],
          spans: [...line.querySelectorAll("span")].map((span) => { const css = getComputedStyle(span); return [css.fontFamily, css.fontSize, css.lineHeight]; }) };
      }).filter((line) => line.top >= viewport.top && line.top + line.height <= viewport.bottom);
      return { column: column.dataset.column, lines, top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight };
    });
    const buttons = [...document.querySelectorAll(".diff-row-actions button")].map((button) => {
      const rect = button.getBoundingClientRect(); return { id: button.dataset.rowId, top: rect.top, height: rect.height };
    });
    return { columns, buttons };
  });
  let coordinates = 0, arrows = 0;
  const expectedStyle = sample.columns[0].lines[0]?.style;
  assert(expectedStyle, `${label}: 表示行がありません`);
  for (const column of sample.columns) for (const line of column.lines) {
    assert.deepEqual(line.style, expectedStyle, `${label}: 列の書式が不一致`);
    for (const span of line.spans) assert.deepEqual(span, expectedStyle.slice(0, 3), `${label}: 構文強調の書式が不一致`);
    for (const other of sample.columns) {
      const matching = other.lines.find((candidate) => candidate.id === line.id);
      if (matching) { assert(Math.abs(line.top - matching.top) <= .6, `${label}: ${line.id} の行位置不一致 ${line.top}/${matching.top}`); coordinates++; }
    }
    for (const button of sample.buttons.filter((button) => button.id === line.id)) {
      assert(Math.abs(line.top + line.height / 2 - button.top - button.height / 2) <= .6,
        `${label}: ${line.id} の矢印位置不一致 ${line.top}/${button.top}`); arrows++;
    }
  }
  assert(coordinates > 0);
  const tops = sample.columns.map((column) => column.top);
  assert(Math.max(...tops) - Math.min(...tops) <= 1, `${label}: スクロールのずれ ${tops}`);
  return { label, coordinates, arrows, style: expectedStyle, scroll: sample.columns.map(({ column, top, height, client }) => ({ column, top, height, client })) };
}
async function assertPreviewColumnsFollowCode(page, label) {
  const layout = await page.evaluate(() => {
    const rect = (element) => { const value = element.getBoundingClientRect(); return { left: value.left, width: value.width }; };
    return {
      code: [...document.querySelectorAll(".document-diff__pane")].map(rect),
      preview: [...document.querySelectorAll(".diff-previews__columns > article")].map(rect),
    };
  });
  assert.equal(layout.code.length, layout.preview.length, `${label}: コードとプレビューの列数が不一致`);
  for (const [index, code] of layout.code.entries()) {
    assert(Math.abs(code.left - layout.preview[index].left) <= .6, `${label}: ${index}列目の左端が不一致`);
    assert(Math.abs(code.width - layout.preview[index].width) <= .6, `${label}: ${index}列目の幅が不一致`);
  }
}
async function dragSeparator(page, selector, deltaX) {
  const handle = page.locator(selector).first();
  const before = await handle.boundingBox(); assert(before, `${selector}: 境界がありません`);
  await page.mouse.move(before.x + before.width / 2, before.y + Math.min(20, before.height / 2));
  await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + deltaX, before.y + Math.min(20, before.height / 2)); await page.mouse.up();
  await settle(page);
}

try {
  await mkdir(output, { recursive: true });
  await build({ configFile: false, root: harness, plugins: [react()], logLevel: "warn", build: { outDir: resolve(output, "harness"), emptyOutDir: false } });
  server = await preview({ configFile: false, root: harness, build: { outDir: resolve(output, "harness") }, preview: { host: "127.0.0.1", port: 0, open: false } });
  const address = server.httpServer.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  // 既存ブラウザー・既存プロファイル・OS入力を使用しない。
  browser = await chromium.launch({ headless: true, ...(process.env.DIFF_BROWSER_PATH ? { executablePath: process.env.DIFF_BROWSER_PATH } : { channel: "msedge" }) });
  report.engine = browser.version();
  for (const width of [1440, 768, 390]) for (const theme of ["light", "dark"]) for (const zoom of [1, 2]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "ja-JP", serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(String(error)));
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const name = `${width}px-${theme}-${zoom * 100}%`;
    const checks = [];
    try {
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.diffTest?.state().review);
      await page.evaluate(({ theme, width, zoom }) => {
        document.documentElement.style.zoom = String(zoom);
        window.diffTest.reset({ threeWay: false, theme, mode: width === 390 ? "preview" : width === 768 ? "split" : "edit" });
      }, { theme, width, zoom });
      await settle(page);
      assert.equal(await page.locator(".cm-editor").count(), width === 390 ? 0 : 2);
      assert.equal(await page.locator(".diff-previews__columns > article").count(), width === 1440 ? 0 : 2);
      if (width === 390) {
        const before = await page.locator(".diff-previews__columns > article").first().boundingBox();
        await dragSeparator(page, '.diff-preview-resize[aria-label="比較列の幅を変更"]', 60);
        const after = await page.locator(".diff-previews__columns > article").first().boundingBox();
        assert(before && after && Math.abs(after.width - before.width) > 1, "閲覧プレビューの横境界が動きません");
        await page.evaluate(() => window.diffTest.external());
        await settle(page);
        assert.equal(await page.locator(".cm-editor").count(), 0);
        assert.equal(await page.locator(".diff-previews__columns > article").count(), 3);
        assert.equal(await page.locator(".diff-resize-handle").count(), 0);
        report.cases.push({ name, status: "passed", checks: [{ label: "閲覧プレビュー", panes: 3 }] });
        process.stdout.write(`${name}: PASS\n`);
        continue;
      }
      checks.push(await measure(page, "2way先頭"));
      if (width === 768) {
        await assertPreviewColumnsFollowCode(page, "2way上下列");
        const before = await page.locator('[data-pane-key="storage"]').boundingBox();
        await dragSeparator(page, '.diff-action-column [role="separator"]', 60);
        const after = await page.locator('[data-pane-key="storage"]').boundingBox();
        assert(before && after && Math.abs(after.width - before.width) > 1, "編集/閲覧の横境界が動きません");
        await assertPreviewColumnsFollowCode(page, "2way横変更後");
      }
      await page.evaluate(() => window.diffTest.external());
      await settle(page);
      assert.equal(await page.locator(".cm-editor").count(), 3);
      checks.push(await measure(page, "3way先頭"));
      if (width === 768) await assertPreviewColumnsFollowCode(page, "3way上下列");
      for (const top of [440, 1e8]) {
        await page.evaluate((top) => { document.querySelector('[data-pane-key="result"] .cm-scroller').scrollTop = top; }, top);
        checks.push(await measure(page, top === 440 ? "途中" : "末尾"));
      }
      await page.evaluate(() => { document.querySelector('[data-pane-key="result"] .cm-scroller').scrollTop = 0; });
      await settle(page);
      const before = await page.evaluate(() => window.diffTest.state());
      await page.evaluate(() => document.querySelector('[data-row-id="base:1"][data-choice="storage"]').click());
      await settle(page);
      const after = await page.evaluate(() => window.diffTest.state());
      assert.notEqual(before.content, after.content); assert.equal(after.saves, 0);
      checks.push(await measure(page, "採用後"));
      await page.evaluate(() => document.querySelector('[data-row-id="base:1"][data-choice="local"]').click());
      await settle(page);
      assert.equal((await page.evaluate(() => window.diffTest.state())).content, before.content);
      await page.evaluate(() => window.diffTest.reset({ threeWay: true, theme: "dark", mode: "edit", empty: true }));
      checks.push(await measure(page, "空文書への追加"));
      assert.equal(report.errors.length, 0, report.errors.join("\n"));
      report.cases.push({ name, status: "passed", checks });
      process.stdout.write(`${name}: PASS\n`);
    } catch (error) { report.cases.push({ name, status: "failed", checks, error: String(error) }); throw error; }
    finally { await context.close(); }
  }
} catch (error) { report.errors.push(String(error)); process.exitCode = 1; process.stderr.write(`${error}\n`); }
finally {
  await browser?.close();
  await new Promise((done) => server ? server.httpServer.close(done) : done());
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`検証レポート: ${resolve(output, "report.json")}\n`);
}
