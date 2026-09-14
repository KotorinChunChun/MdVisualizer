import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { assertButtonLayoutAudit, assertButtonLayoutHelperSelfTest, collectButtonLayoutAudit, WEB_BUTTON_LAYOUT_SCOPES } from "./button-layout-audit.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = (process.env.MDVISUALIZER_VERSION || packageJson.version).replace(/^v/, "").split("+")[0];
const target = process.argv[2] || process.env.MDVISUALIZER_BUTTON_AUDIT_URL || pathToFileURL(resolve(root, "release/web/mdvisualizer.html")).href;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDirectory = resolve(root, `dev/history/v${version}/logs/button-layout-${runId}`);
await mkdir(outputDirectory, { recursive: true });
await access(resolve(root, "node_modules/playwright-core"));

const browser = await chromium.launch({ channel: process.env.MDVISUALIZER_BROWSER_CHANNEL || "msedge", headless: true });
const errors = [];
try {
  const viewports = [];
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on("pageerror", (error) => errors.push(`${width}px: ${error.message}`));
    await assertButtonLayoutHelperSelfTest(page);
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await page.locator(".web-app").waitFor();
    assert.equal(await page.locator('[data-ui-command="view.preview"]').inputValue(), 'preview', 'WebAppの初期表示はプレビュー');
    const initial = await collectButtonLayoutAudit(page, WEB_BUTTON_LAYOUT_SCOPES);
    assertButtonLayoutAudit(initial);

    // 狭幅ではオプションで文書コマンドを開く。広幅では既に表示されている。
    const optionsToggle = page.locator('.web-options-toggle');
    if (await page.locator('.web-command-area').isHidden()) await optionsToggle.click();
    const commands = await collectButtonLayoutAudit(page, [{ id: 'web-command-area-open', selector: '.web-command-area', required: true }]);
    assertButtonLayoutAudit(commands);
    await page.locator('[data-ui-command="view.preview"]').selectOption('off');
    const toolbarSummary = page.locator('.markdown-editor__toolbar-details > summary');
    if (await toolbarSummary.isVisible()) await toolbarSummary.click();
    const editor = await collectButtonLayoutAudit(page, [{ id: 'web-editor-toolbar', selector: '.markdown-editor__toolbar', required: true }]);
    assertButtonLayoutAudit(editor);
    const htmlExport = page.getByRole("button", { name: "HTML出力", exact: true });
    let modal = [];
    if (await htmlExport.count()) {
      if (await htmlExport.isVisible()) await htmlExport.click();
      await page.locator('.html-export-dialog[role="dialog"]').waitFor();
      modal = await collectButtonLayoutAudit(page, [{ id: "web-html-export-modal", selector: ".html-export-dialog", required: true }]);
      assertButtonLayoutAudit(modal);
    }
    viewports.push({ width, height: 1000, scopes: [...initial, ...commands, ...editor, ...modal] });
    await page.close();
  }
  assert.deepEqual(errors, [], `WebApp pageerror: ${errors.join(" | ")}`);
  const report = { target, version: `v${version}`, viewports, pageErrors: errors };
  await writeFile(resolve(outputDirectory, "button-layout-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`Webボタン配置監査: PASS（レポート=${resolve(outputDirectory, "button-layout-report.json")}）`);
} finally {
  await browser.close();
}
