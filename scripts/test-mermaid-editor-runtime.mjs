import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleSource = await readFile(path.join(root, 'src/generated/mermaidEditorDocument.ts'), 'utf8');
const match = /export const mermaidEditorDocument = ([\s\S]*);\s*$/.exec(moduleSource);
if (!match) throw new Error('生成されたMermaidエディター文書を読み取れません。');
const documentSource = JSON.parse(match[1]);
const escaped = JSON.stringify(documentSource).replace(/<\/script/gi, '<\\/script');
const harness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}#studio{display:block;width:1280px;height:800px;border:0}</style><button id="apply">反映</button><output id="result"></output><iframe sandbox="allow-scripts allow-same-origin allow-modals allow-forms" id="studio"></iframe><script>const source=${escaped};const frame=document.querySelector('#studio');const nonce='runtime-test-nonce';frame.srcdoc=source;addEventListener('message',event=>{if(event.source!==frame.contentWindow||!event.data||typeof event.data!=='object')return;const data=event.data;if(data.kind==='mdvisualizer-mermaid-ready')frame.contentWindow.postMessage({kind:'mdvisualizer-mermaid-source',nonce,source:'flowchart LR\\nA[開始] --> B[終了]'},'*');if(data.kind==='mdvisualizer-mermaid-current-source'&&data.nonce===nonce)document.querySelector('#result').textContent=data.source;});document.querySelector('#apply').onclick=()=>frame.contentWindow.postMessage({kind:'mdvisualizer-mermaid-request-current-source',nonce},'*');<\/script>`;
const server = await createServer({ root, appType: 'custom', logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
server.middlewares.use('/mermaid-runtime-harness', (_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(harness); });
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === 'string') throw new Error('Viteテストサーバーのポートを取得できません。');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, hasTouch: true });
  await page.goto(`http://127.0.0.1:${address.port}/mermaid-runtime-harness`);
  const frame = page.frames().find(item => item !== page.mainFrame());
  if (!frame) throw new Error('Mermaidエディターiframeを開けません。');
  await frame.locator('#diagram svg').waitFor({ timeout: 15_000 });
  await frame.locator('#diagram g.node').first().click();
  await frame.locator('#edit').click();
  const label = frame.locator('#form-fields input').first();
  await label.fill('開始（編集済み）');
  await frame.locator('#form-content button[type="submit"]').click();
  await page.locator('#apply').click();
  await page.locator('#result').filter({ hasText: '開始（編集済み）' }).waitFor({ timeout: 10_000 });
  await frame.locator('#load-samples').click();
  await frame.waitForFunction(() => document.querySelectorAll('#documents .doc').length >= 30, undefined, { timeout: 15_000 });
  const documents = await frame.locator('#documents .doc').count();
  if (documents < 30) throw new Error(`同梱サンプルの読込数が不足しています: ${documents}`);
  const renderFailures = await frame.evaluate(async () => {
    const studio = window.mermaidStudio;
    const results = [];
    for (const document of studio.documents) {
      const result = await studio.renderer.render(document.code, true);
      if (!result.svg) results.push(document.name);
    }
    return results;
  });
  if (renderFailures.length) throw new Error(`同梱サンプルを描画できません: ${renderFailures.join(', ')}`);
  await page.setViewportSize({ width: 430, height: 960 });
  await page.locator('#studio').evaluate(element => { element.style.width = '390px'; });
  await frame.locator('#diagram g.node').first().tap();
  await frame.locator('#edit').tap();
  await frame.locator('#form-fields input').first().fill('開始（モバイル編集済み）');
  await frame.locator('#form-content button[type="submit"]').tap();
  await page.locator('#apply').click();
  await page.locator('#result').filter({ hasText: '開始（モバイル編集済み）' }).waitFor({ timeout: 10_000 });
  console.log(`Mermaid runtime smoke passed: SVG, desktop/mobile GUI node edit, source return, ${documents} samples`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
