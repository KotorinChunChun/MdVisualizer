import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { createServer } from 'vite';
import { launchBrowser } from '../../scripts/html-export/export.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const logRoot = path.join(root, 'dev/history/v0.0.18/logs/html-export-browser-bridge');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const svgWithHtmlLabel = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 60"><foreignObject width="160" height="60"><div xmlns="http://www.w3.org/1999/xhtml" style="font:20px sans-serif;color:#102030;background:#dbeafe">HTMLラベル</div></foreignObject></svg>';

test('ブラウザー橋渡しは単一HTML、Mermaid、foreignObject PNG、失敗と中止を扱う', { timeout: 180_000 }, async (t) => {
  const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 5173, strictPort: false } });
  await server.listen();
  t.after(async () => { await server.close(); });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/tests/html-export/browser-bridge-harness.html`);
  await page.waitForFunction(() => Boolean(window.runHtmlExport));
  const base = 'memory://document/';
  const asset = { base, mime: 'image/png', data: `data:image/png;base64,${pixel}` };
  const markdown = '# HTML出力\n\n![画像](image.png)\n\n```mermaid\ngraph LR\n A[開始] --> B[完了]\n```\n\n```svg\n' + svgWithHtmlLabel + '\n```\n\n| 名前 | 値 |\n| --- | --- |\n| A | 1 |';
  const staticResult = await page.evaluate(async ({ markdown, base, asset }) => window.runHtmlExport({ markdown, baseDir: base, title: '橋渡し', theme: 'light', mode: 'static', readAsset: async () => asset }), { markdown, base, asset });
  assert.equal(staticResult.mode, 'static'); assert.ok(staticResult.rasterized >= 1); assert.ok(staticResult.diagrams >= 2);
  assert.match(staticResult.html, /data:image\/png;base64,/); assert.match(staticResult.html, /Mermaid図/);
  assert.doesNotMatch(staticResult.html, /<script\b/i);
  const mermaidSource = await page.evaluate((html) => new DOMParser().parseFromString(html, 'text/html').querySelector('img[alt="Mermaid図"]')?.getAttribute('src'), staticResult.html);
  assert.match(mermaidSource || '', /^data:image\/svg\+xml;base64,/, 'HTMLラベルを使わないMermaidはSVGとして保持する');
  const foreignObjectPixels = await page.evaluate(async (html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const source = [...document.images].map((image) => image.src).filter((src) => src.startsWith('data:image/png')).at(-1);
    const image = new Image(); image.src = source;
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(8, 8, 1, 1).data];
  }, staticResult.html);
  assert.deepEqual(foreignObjectPixels.slice(0, 3), [219, 234, 254], 'foreignObjectの背景・HTML装飾をPNG画素として保持する');
  const interactiveResult = await page.evaluate(async ({ markdown, base, asset }) => window.runHtmlExport({ markdown, baseDir: base, title: '橋渡し', theme: 'dark', mode: 'interactive', readAsset: async () => asset }), { markdown, base, asset });
  assert.equal(interactiveResult.mode, 'interactive'); assert.equal((interactiveResult.html.match(/<script\b/g) ?? []).length, 1);
  const missing = await page.evaluate(async (base) => {
    try { await window.runHtmlExport({ markdown: '![不足](missing.png)', baseDir: base, title: '不足', theme: 'light', readAsset: async () => { throw new Error('not found'); } }); return null; }
    catch (error) { return String(error.message); }
  }, base);
  assert.match(missing, /項目1|not found/);
  const cancelled = await page.evaluate(async (base) => {
    const controller = new AbortController();
    const result = window.runHtmlExport({ markdown: '![待機](slow.png)', baseDir: base, title: '中止', theme: 'light', signal: controller.signal, readAsset: async () => new Promise(() => {}) });
    controller.abort();
    try { await result; return null; } catch (error) { return String(error.message); }
  }, base);
  assert.match(cancelled, /中止/);
  const preAborted = await page.evaluate(async (base) => {
    const controller = new AbortController(); controller.abort();
    try { await window.runHtmlExport({ markdown: '# 中止', baseDir: base, title: '中止', theme: 'light', signal: controller.signal, readAsset: async () => { throw new Error('読込不要'); } }); return null; }
    catch (error) { return String(error.message); }
  }, base);
  assert.match(preAborted, /中止/);
  assert.equal(await page.locator('iframe[title="HTML出力用レンダラー"]').count(), 0);
});

test('実draw.ioビューアーで複数ページ・日本語HTMLラベル・図内画像をPNGへ保持する', { timeout: 180_000 }, async (t) => {
  const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 5173, strictPort: false } }); await server.listen(); t.after(async () => { await server.close(); });
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const browser = await launchBrowser(); t.after(async () => { await browser.close(); });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}/tests/html-export/browser-bridge-harness.html`); await page.waitForFunction(() => Boolean(window.runHtmlExport));
  const icon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="14" fill="#ff0000"/></svg>').toString('base64');
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="日本語の図&lt;br&gt;二行目" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="200" height="80" as="geometry"/></mxCell>' + `<mxCell id="3" style="shape=image;image=data:image/svg+xml;base64,${icon};" vertex="1" parent="1"><mxGeometry x="250" y="65" width="30" height="30" as="geometry"/></mxCell></root></mxGraphModel>`;
  const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
  const xml = `<mxfile><diagram id="one" name="ページ1">${model}</diagram><diagram id="two" name="ページ2">${compressed}</diagram></mxfile>`;
  const result = await page.evaluate(async (xml) => window.runHtmlExport({ markdown: '# draw.io\n\n```drawio\n' + xml + '\n```', baseDir: 'memory://drawio/', title: 'draw.io', theme: 'light', readAsset: async (source) => ({ base: 'memory://drawio/', mime: 'image/svg+xml', text: atob(source.slice(source.indexOf(',') + 1)), data: source }) }), xml);
  assert.equal(result.rasterized, 2); assert.doesNotMatch(result.html, /foreignObject|mxGraphModel|viewer-static/);
  const png = await page.evaluate(async (html) => {
    const document = new DOMParser().parseFromString(html, 'text/html'); const sources = [...document.images].map((image) => image.src);
    const pixels = [];
    for (const source of sources) { const image = new Image(); image.src = source; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let red = 0; for (let index = 0; index < data.length; index += 4) if (data[index] > 220 && data[index + 1] < 80 && data[index + 2] < 80) red++; pixels.push({ width: image.naturalWidth, height: image.naturalHeight, red }); }
    return pixels;
  }, result.html);
  assert.equal(png.length, 2); assert.ok(png.every((image) => image.width > 0 && image.height > 0)); assert.ok(png.every((image) => image.red > 100), '図内の赤いData URLアイコンを両ページのPNG画素で確認する');
  await mkdir(logRoot, { recursive: true }); await page.setContent(result.html); await page.screenshot({ path: path.join(logRoot, 'drawio-multi-page.png'), fullPage: true });
});
