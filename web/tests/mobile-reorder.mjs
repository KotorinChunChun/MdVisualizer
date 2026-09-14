import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve('dev/history/v0.0.18/logs/mobile-reorder');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.on('dialog', dialog => dialog.accept());
const errors = []; page.on('pageerror', error => errors.push(error.message));
const client = await context.newCDPSession(page);
const touch = async (type, point) => client.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [] });
const fixture = '# 並べ替え\n\n最初の段落\n\n二番目の段落\n\n最後の段落\n';
const sourceText = async () => {
  await page.locator('.web-view-selector select').selectOption('source');
  const text = (await page.locator('.web-editor-pane .cm-line').allTextContents()).join('\n');
  await page.locator('.web-view-selector select').selectOption('preview');
  return text;
};
const load = async text => {
  await page.locator('input[type=file]').setInputFiles({ name: '並べ替え.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await page.locator('article [data-source-line="3"]').first().waitFor();
};
const point = async (line, bottom = false) => {
  const node = page.locator(`article [data-source-line="${line}"]`).first();
  await node.scrollIntoViewIfNeeded();
  const rect = await node.boundingBox();
  assert(rect); return { x: rect.x + Math.min(100, rect.width / 2), y: bottom ? rect.y + rect.height - 3 : rect.y + rect.height / 2 };
};
try {
  await page.goto(process.argv[2] || pathToFileURL(resolve('release/web/mdvisualizer.html')).href);
  await page.locator('.web-app').waitFor(); await load(fixture);
  const from = await point(3), to = await point(7, true);
  await touch('touchStart', from); await page.waitForTimeout(650);
  assert.equal(await page.locator('.web-reorder-picked').count(), 1);
  await touch('touchMove', to);
  await page.locator('.web-reorder-insertion').waitFor();
  await page.screenshot({ path: resolve(out, 'insertion.png') });
  await touch('touchEnd');
  assert.equal(await sourceText(), '# 並べ替え\n\n二番目の段落\n\n最後の段落\n\n最初の段落\n');
  await page.getByRole('button', { name: '行移動を元に戻す', exact: true }).tap();
  assert.equal(await sourceText(), fixture);
  // A regular scrolling gesture and a touch cancellation never mutate the source.
  await touch('touchStart', await point(3)); await touch('touchMove', { x: from.x, y: from.y + 25 }); await touch('touchEnd');
  assert.equal(await sourceText(), fixture);
  await touch('touchStart', await point(3)); await page.waitForTimeout(650); await touch('touchCancel');
  assert.equal(await sourceText(), fixture);
  // A stationary long press enables explicit buttons without an implicit move.
  await touch('touchStart', await point(3)); await page.waitForTimeout(650); await touch('touchEnd');
  await page.getByRole('button', { name: '移動を取消', exact: true }).tap();
  assert.equal(await sourceText(), fixture);
  const list = '# リスト\n\n- 一番\n- 二番\n- 三番\n';
  await load(list);
  await touch('touchStart', await point(3)); await page.waitForTimeout(650); await touch('touchMove', await point(5, true)); await touch('touchEnd');
  assert.equal(await sourceText(), '# リスト\n\n- 二番\n- 三番\n- 一番\n');
  const table = '# 表\n\n| 名前 |\n| --- |\n| 一番 |\n| 二番 |\n| 三番 |\n';
  await load(table);
  await touch('touchStart', await point(5)); await page.waitForTimeout(650); await touch('touchMove', await point(7, true)); await touch('touchEnd');
  assert.equal(await sourceText(), '# 表\n\n| 名前 |\n| --- |\n| 二番 |\n| 三番 |\n| 一番 |\n');
  await load(fixture);
  await page.locator('article [data-source-line="3"]').first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(await sourceText(), '# 並べ替え\n\n二番目の段落\n\n最初の段落\n\n最後の段落\n');
  await page.screenshot({ path: resolve(out, 'completed.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'PASS', scenarios: ['paragraph drag', 'undo', 'scroll no mutation', 'touchcancel', 'stationary press cancel', 'list row drag', 'table row drag'], errors }, null, 2));
  console.log(`Mobile reorder PASS: ${out}`);
} finally { await browser.close(); }
