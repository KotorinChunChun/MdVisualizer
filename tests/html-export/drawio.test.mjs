import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { exportHtml, launchBrowser } from '../../scripts/html-export/export.mjs';
import { pathToFileURL } from 'node:url';

test('実draw.ioビューアーで非圧縮・圧縮・複数ページを静的出力する', { skip: !process.env.HTML_EXPORT_DRAWIO_VIEWER, timeout: 120_000 }, async () => {
  const icon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="14" fill="#ff0000"/></svg>').toString('base64');
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="日本語の図&lt;br&gt;二行目" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="200" height="80" as="geometry"/></mxCell>' +
    `<mxCell id="3" style="shape=image;image=data:image/svg+xml,${icon};" vertex="1" parent="1"><mxGeometry x="250" y="65" width="30" height="30" as="geometry"/></mxCell></root></mxGraphModel>`;
  const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
  const xml = `<mxfile><diagram id="one" name="ページ1">${model}</diagram><diagram id="two" name="ページ2">${compressed}</diagram></mxfile>`;
  const dir = path.resolve('tmp/html-export'); await mkdir(dir, { recursive: true });
  const output = path.join(dir, 'drawio.html');
  const result = await exportHtml({ markdown: '# draw.io受入\n\n```drawio\n' + xml + '\n```', output, force: true, theme: 'light', drawioViewer: process.env.HTML_EXPORT_DRAWIO_VIEWER });
  assert.equal(result.rasterized, 2);
  const html = await readFile(output, 'utf8');
  assert.doesNotMatch(html, /<script|<iframe|mxGraphModel|data-mxgraph/);
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ offline: true, javaScriptEnabled: false });
    const page = await context.newPage(); await page.goto(pathToFileURL(output).href);
    assert.equal(await page.locator('img').count(), 2);
    assert.equal(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
    await page.screenshot({ path: path.join(dir, 'drawio.png'), fullPage: true });
  } finally { await browser.close(); }
});
