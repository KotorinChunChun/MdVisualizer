import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportHtml, launchBrowser } from '../../scripts/html-export/export.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const simpleSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 100"><rect width="240" height="100" fill="#dbeafe"/><text x="15" y="55" fill="#102030" font-size="24">SVGの日本語</text></svg>';

test('独立出力とオフライン閲覧の受入', { timeout: 180_000 }, async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'mdvisualizer-export-e2e-'));
  t.after(async () => { assert.equal(path.dirname(folder), tmpdir()); assert.ok(path.basename(folder).startsWith('mdvisualizer-export-e2e-')); await rm(folder, { recursive: true, force: true }); });
  const assets = path.join(folder, 'assets'); await mkdir(assets);
  await writeFile(path.join(assets, 'pixel.png'), Buffer.from(png, 'base64'));
  await writeFile(path.join(assets, 'shape.svg'), simpleSvg);
  await writeFile(path.join(assets, 'external.mmd'), 'graph LR\n A[外部図] --> B[日本語]');
  await writeFile(path.join(assets, 'table.csv'), '名前,数値\n' + Array.from({ length: 125 }, (_, index) => `行${index},${index}`).join('\n'));
  const output = path.join(folder, 'document.html');
  const markdown = '# 出力の受入\n\n[本文へ](#本文) [原本](other.md) [Web](https://example.com)\n\n## 本文\n\n日本語の**本文**と\n複数行です。\n\n- [x] 確認済み\n- [ ] 残件\n\n![画像](assets/pixel.png)\n\n![SVG](assets/shape.svg)\n\n![外部図](assets/external.mmd)\n\n![全行表](assets/table.csv)\n\n' +
    '```mermaid\ngraph TD\n A["長い日本語のラベル<br/>二行目の文字"] --> B[終点]\n```\n\n' +
    '```plantuml\n@startuml\nAlice -> Bob : hello\n@enduml\n```\n\n' +
    '```typescript\nconst result = "コード";\n```\n\n' +
    '| 名前 | 数値 |\n| --- | --- |\n| A | 10 |\n| B | 20 |\n| 合計 | |\n\n' +
    '<details><summary>折りたたみ</summary>隠れた本文</details>\n\n<script>window.EXECUTED=true</script><img src="assets/pixel.png" onerror="window.EXECUTED=true"><iframe src="https://example.com/"></iframe>';

  const result = await exportHtml({ markdown, baseDir: folder, output, title: '安全<title>', theme: 'light' });
  assert.ok(result.bytes > 1000); assert.equal(result.rasterized, 0); assert.equal(result.tables, 2);
  const html = await readFile(output, 'utf8');
  assert.doesNotMatch(html, /<(?:script|iframe|button|input|select|textarea|link|object)\b/i);
  assert.doesNotMatch(html, /\son\w+=|data-export-|Rendering Mermaid|viewer-static|assets\/pixel|assets\/shape|other\.md/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  const svgs = [...html.matchAll(/data:image\/svg\+xml;base64,([^"\s]+)/g)].map(match => Buffer.from(match[1], 'base64').toString());
  assert.ok(svgs.some(svg => svg.includes('二行目の文字')));
  assert.ok(svgs.some(svg => svg.includes('外部図')));
  assert.ok(svgs.every(svg => !/foreignObject/i.test(svg)));
  assert.match(html, /data:image\/png;base64,/);
  const moved = path.join(folder, 'moved'); await mkdir(moved); await copyFile(output, path.join(moved, 'only.html'));
  // 元資産を削除し、HTML一つだけで成立することを確認する。
  assert.equal(path.dirname(assets), folder); await rm(assets, { recursive: true });
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const page = await context.newPage(); const requests = [];
    page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
    await page.goto(pathToFileURL(path.join(moved, 'only.html')).href);
    assert.equal(await page.title(), '安全<title>');
    assert.equal(await page.locator('.export-code-language').textContent(), 'typescript');
    assert.equal(await page.locator('pre code').textContent(), 'const result = "コード";');
    assert.equal(await page.locator('table').first().locator('tbody tr').count(), 125);
    assert.equal(await page.locator('table').first().locator('tbody tr').last().textContent(), '行124124');
    assert.equal(await page.locator('table').last().locator('tbody tr').last().textContent(), '合計30');
    assert.match(await page.locator('body').textContent(), /隠れた本文/);
    assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
    assert.deepEqual(requests, []);
    assert.ok(await page.locator('img[alt="外部図"]').evaluate(img => img.naturalWidth < 1000), '図を囲む本文幅の空白をPNGに含めない');
    assert.equal(await page.locator('.hljs-keyword').first().evaluate(el => getComputedStyle(el).color), 'rgb(207, 34, 46)');
    const artifacts = path.resolve('tmp/html-export'); await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'acceptance-light.png'), fullPage: true });
    await copyFile(output, path.join(artifacts, 'acceptance-light.html'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    await page.screenshot({ path: path.join(artifacts, 'acceptance-mobile.png') });
  } finally { await browser.close(); }

  await t.test('欠落画像・壊れた図・外部CSS・キャンセルで既存HTMLを保持する', async () => {
    for (const options of [
      { markdown: '![欠落](missing.png)' },
      { markdown: '```mermaid\nthis is not a graph\n```' },
      { markdown: '# CSS', css: '.markdown-body { background: url(https://example.com/image.png) }' },
      { markdown: '# cancel', signal: AbortSignal.abort() },
    ]) {
      await assert.rejects(exportHtml({ baseDir: folder, output, force: true, ...options }));
      assert.equal(await readFile(output, 'utf8'), html);
    }
  });
  await t.test('SVGのイベント・スクリプトを除去し、外部useの欠落を成功扱いにしない', async () => {
    const unsafe = simpleSvg.replace('</svg>', '<script>alert(1)</script><rect onload="alert(2)" width="1" height="1"/></svg>');
    const safeOutput = path.join(folder, 'safe.html');
    await exportHtml({ markdown: '```svg\n' + unsafe + '\n```', output: safeOutput });
    const contents = await readFile(safeOutput, 'utf8');
    const encoded = /data:image\/svg\+xml;base64,([^"\s]+)/.exec(contents)[1];
    assert.doesNotMatch(Buffer.from(encoded, 'base64').toString(), /script|onload/);
    await assert.rejects(exportHtml({ markdown: '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="missing.svg#x"/></svg>\n```', output: safeOutput, force: true }));
    assert.equal(await readFile(safeOutput, 'utf8'), contents);
  });
  await t.test('SVGのHTMLラベル内の画像をPNGへ保持する', async () => {
    const imageOutput = path.join(folder, 'label-image.html');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img width="40" height="40" src="data:image/png;base64,' + png + '"/></div></foreignObject></svg>';
    const result = await exportHtml({ markdown: '```svg\n' + svg + '\n```', output: imageOutput, theme: 'light' });
    assert.equal(result.rasterized, 1);
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage(); await page.goto(pathToFileURL(imageOutput).href);
      const redPixels = await page.locator('img').evaluate(img => {
        const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let red = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80) red++;
        return red;
      });
      assert.ok(redPixels > 100, '図のラベルに埋め込んだ画像の画素が残る');
    } finally { await browser.close(); }
  });

  await t.test('モード・ファイル名・コピー・折り返し・目次の受入', async () => {
    const output = path.join(folder, 'interactive.html');
    const source = 'const value = "' + '長い文字列'.repeat(80) + '";';
    const markdown = '# 先頭\n\n## 移動先\n\n' +
      '\x60\x60\x60typescript title="src/main.ts"\n' + source + '\n\x60\x60\x60\n\n' +
      '\x60\x60\x60js:src/other.js\nconsole.log(2);\n\x60\x60\x60\n\n' +
      '\x60\x60\x60python filename="hello world.py"\nprint(3)\n\x60\x60\x60\n\n' +
      '| 名前 | 値 |\n| --- | --- |\n| 日本語 | 42 |\n\n<script>window.BAD=true</script>';
    // テンプレート内でフェンスを表現するためのエスケープを復元する。
    const input = markdown.replaceAll('\\x60', '\x60');
    await exportHtml({ markdown: input, output, mode: 'interactive', theme: 'light' });
    const html = await readFile(output, 'utf8');
    assert.equal((html.match(/<script\b/g) ?? []).length, 1);
    assert.doesNotMatch(html, /window\.BAD|onerror=/);
    const nonce = /<script nonce="([^"]+)"/.exec(html)[1];
    assert.ok(html.includes("script-src 'nonce-" + nonce + "'"));
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      assert.deepEqual(await page.locator('.export-code-language').allTextContents(), ['typescript · src/main.ts', 'js · src/other.js', 'python · hello world.py']);
      const block = page.locator('.export-code-block').first();
      await block.getByRole('button', { name: 'コードをコピー', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
      const wrap = block.getByRole('button', { name: 'コードを折り返し', exact: true });
      await wrap.click(); assert.equal(await wrap.getAttribute('aria-pressed'), 'true');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await block.locator('code').evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap');
      assert.ok(await block.locator('pre').evaluate(el => el.scrollWidth <= el.clientWidth));
      assert.equal(await block.locator('code').textContent(), source);
      await wrap.click(); assert.equal(await wrap.getAttribute('aria-pressed'), 'false');
      await page.getByRole('button', { name: '表をコピー', exact: true }).click();
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), '名前\t値\n日本語\t42');
      await page.getByRole('button', { name: '表を折り返し', exact: true }).click();
      assert.equal(await page.locator('table').evaluate(el => getComputedStyle(el).tableLayout), 'fixed');
      await page.locator('.export-toc summary').click();
      await page.getByRole('navigation', { name: '目次' }).getByRole('link', { name: '移動先', exact: true }).click();
      assert.ok(new URL(page.url()).hash.length > 1);
      // Clipboard API拒否時のフォールバックも成功表示の誤報がないことを確認。
      await page.evaluate(() => { window.readClipboardForTest = navigator.clipboard.readText.bind(navigator.clipboard); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw Error('拒否'); } }, configurable: true }); });
      await block.getByRole('button', { name: 'コードをコピー', exact: true }).click();
      assert.equal(await page.locator('.export-toast').textContent(), 'コピーしました');
      assert.equal(await page.locator('textarea').count(), 0);
      assert.equal(await page.evaluate(() => window.readClipboardForTest()), source);
      await page.evaluate(() => { document.execCommand = () => false; });
      await block.getByRole('button', { name: 'コードをコピー', exact: true }).click();
      assert.match(await page.locator('.export-toast').textContent(), /コピーできません/);
      assert.deepEqual(errors, []);
      const artifacts = path.resolve('tmp/html-export');
      await page.setViewportSize({ width: 1280, height: 960 });
      await page.screenshot({ path: path.join(artifacts, 'interactive-acceptance.png'), fullPage: true });
      const disabled = await browser.newPage({ javaScriptEnabled: false, offline: true }); await disabled.goto(pathToFileURL(output).href);
      assert.equal(await disabled.locator('pre code').first().textContent(), source);
      assert.equal(await disabled.locator('button:visible').count(), 0);
    } finally { await browser.close(); }
    const staticOutput = path.join(folder, 'static-metadata.html');
    await exportHtml({ markdown: input, output: staticOutput, mode: 'static', theme: 'light' });
    const staticHtml = await readFile(staticOutput, 'utf8');
    assert.doesNotMatch(staticHtml, /<(?:script|button|nav)\b/);
    assert.match(staticHtml, /typescript · src\/main.ts/);
    assert.match(staticHtml, /script-src 'none'/);
    const original = await readFile(output, 'utf8');
    await assert.rejects(exportHtml({ markdown: '# invalid', output, mode: 'unknown', force: true }));
    assert.equal(await readFile(output, 'utf8'), original);
  });


  await t.test('通知の消去・図拡大・章の開閉・表の全列検索と並べ替え', async () => {
    const output = path.join(folder, 'reading.html');
    await exportHtml({ output, mode: 'interactive', theme: 'light', markdown: '# 文書\n\n## 一章\n\n本文\n\n### 内側\n\n内側本文\n\n## 二章\n\n![図](data:image/svg+xml;base64,' + Buffer.from(simpleSvg).toString('base64') + ')\n\n| 名前 | 数値 | 分類 |\n| --- | --- | --- |\n| Beta | 10 | 東京 |\n| alpha | 2 | 大阪 |\n| Gamma | 30 | 東京 |\n| 合計 | | |' });
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      const toast = page.locator('.export-toast');
      await page.getByRole('button', { name: '表をコピー', exact: true }).click();
      await toast.waitFor({ state: 'visible' });
      assert.equal(await toast.textContent(), 'コピーしました');
      const shown = Date.now(); await toast.waitFor({ state: 'hidden' }); assert.ok(Date.now() - shown >= 2700);
      assert.equal(await toast.textContent(), '');
      await page.getByRole('button', { name: '数値で並べ替え', exact: true }).click();
      assert.deepEqual(await page.locator('tbody tr td:first-child').allTextContents(), ['alpha', 'Beta', 'Gamma', '合計']);
      await page.getByRole('button', { name: '数値で並べ替え', exact: true }).click();
      assert.deepEqual(await page.locator('tbody tr td:first-child').allTextContents(), ['Gamma', 'Beta', 'alpha', '合計']);
      await page.getByRole('button', { name: '数値で並べ替え', exact: true }).click();
      assert.deepEqual(await page.locator('tbody tr td:first-child').allTextContents(), ['Beta', 'alpha', 'Gamma', '合計']);
      const search = page.getByRole('searchbox', { name: '表を絞り込み（全列）' });
      await search.fill('大阪'); assert.deepEqual(await page.locator('tbody tr:visible td:first-child').allTextContents(), ['alpha', '合計']);
      await search.fill('GAM'); assert.deepEqual(await page.locator('tbody tr:visible td:first-child').allTextContents(), ['Gamma', '合計']);
      await page.getByRole('button', { name: '表をコピー', exact: true }).click();
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), '名前\t数値\t分類\nGamma\t30\t東京\n合計\t42\t0');
      await search.fill('該当なし'); assert.equal(await page.locator('tbody tr:visible').count(), 1); assert.match(await page.locator('.export-table-count').textContent(), /0 \/ 3行/);
      await search.fill(''); assert.equal(await page.locator('tbody tr:visible').count(), 4);
      const first = page.getByRole('button', { name: '一章を折りたたむ', exact: true }); await first.click();
      assert.equal(await page.getByText('内側本文', { exact: true }).isVisible(), false);
      await page.locator('.export-toc summary').click();
      await page.getByRole('navigation', { name: '目次' }).getByRole('link', { name: '内側', exact: true }).click();
      assert.equal(await page.getByText('内側本文', { exact: true }).isVisible(), true);
      await page.locator('.export-toc summary').click(); await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
      assert.equal(await page.getByText('内側本文', { exact: true }).isVisible(), false);
      await page.getByRole('button', { name: 'すべて展開', exact: true }).click();
      await page.locator('.export-toc summary').click();
      assert.equal(await page.locator('.export-toc').evaluate(el => getComputedStyle(el).position), 'fixed');
      await page.setViewportSize({ width: 390, height: 844 });
      const box = await page.locator('.export-toc').boundingBox(); assert.ok(box.x + box.width <= 390 && box.y === 12);
      const img = page.getByRole('button', { name: '図を拡大', exact: true }); await img.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '図・画像の拡大表示' }); assert.equal(await dialog.isVisible(), true);
      const before = await dialog.locator('img').evaluate(el => el.getBoundingClientRect().width);
      await dialog.getByRole('button', { name: '拡大', exact: true }).click();
      assert.ok(await dialog.locator('img').evaluate(el => el.getBoundingClientRect().width) > before);
      await dialog.getByRole('button', { name: '画面に合わせる', exact: true }).click();
      assert.equal(await dialog.locator('.export-zoom-size').textContent(), '100%');
      await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false); assert.equal(await img.evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('body').evaluate(el => el.style.overflow), '');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.resolve('tmp/html-export/reading-mobile.png'), fullPage: true });
    } finally { await browser.close(); }
  });

  await t.test('darkテーマと本文CSSを外部スタイルなしで保持する', async () => {
    const darkOutput = path.join(folder, 'dark.html');
    await exportHtml({ markdown: '# 色の確認\n\n本文\n\n```typescript\nconst value = 1;\n```', output: darkOutput, theme: 'dark', css: ':scope p { font-size: 21px; color: #abcdef; }' });
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ javaScriptEnabled: false, offline: true }); await page.goto(pathToFileURL(darkOutput).href);
      assert.equal(await page.locator('p').evaluate(el => getComputedStyle(el).fontSize), '21px');
      assert.equal(await page.locator('p').evaluate(el => getComputedStyle(el).color), 'rgb(171, 205, 239)');
      assert.equal(await page.locator('.hljs-keyword').evaluate(el => getComputedStyle(el).color), 'rgb(199, 146, 234)');
      assert.notEqual(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    } finally { await browser.close(); }
  });
});
