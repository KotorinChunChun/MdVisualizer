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
  assert.ok(result.bytes > 1000); assert.ok(result.rasterized >= 2); assert.equal(result.tables, 2);
  const html = await readFile(output, 'utf8');
  assert.doesNotMatch(html, /<(?:script|iframe|button|input|select|textarea|link|object)\b/i);
  assert.doesNotMatch(html, /\son\w+=|data-export-|Rendering Mermaid|viewer-static|assets\/pixel|assets\/shape|other\.md/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
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
