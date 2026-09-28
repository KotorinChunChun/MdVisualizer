import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { launchBrowser } from '../scripts/html-export/export.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const webRoot = path.join(root, 'web');
const source = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dbeafe"/></svg>').toString('base64')}`;

test('WebImageEditor reuses the annotation UI and returns a browser PNG without native drag-drop', { timeout: 120_000 }, async (t) => {
  const server = await createServer({ root: webRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 5180, strictPort: false } }); await server.listen(); t.after(async () => { await server.close(); });
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const browser = await launchBrowser(); t.after(async () => { await browser.close(); });
  const page = await browser.newPage(); page.setDefaultTimeout(10_000); await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.evaluate(async ({ source }) => {
    document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'web-image-editor-test' }));
    const reactModule = await import('/@id/react'); const React = reactModule.default ?? reactModule; const reactDomModule = await import('/@id/react-dom/client'); const createRoot = reactDomModule.createRoot ?? reactDomModule.default?.createRoot; const { WebImageEditor } = await import('/src/WebImageEditor.tsx');
    window.webImageEditorResult = null; window.webImageEditorError = null;
    createRoot(document.getElementById('web-image-editor-test')).render(React.createElement(WebImageEditor, { source, filename: 'sample.png', onApply: (dataUri) => { window.webImageEditorResult = dataUri; }, onClose: () => { window.webImageEditorError = 'closed'; }, onError: (message) => { window.webImageEditorError = message; } }));
  }, { source });
  await page.getByRole('button', { name: 'ラスタ編集1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '画像編集: sample.png' }); await dialog.waitFor();
  for (const name of ['鉛筆', 'ブラシ', '切り抜き', '四角', 'マスク']) await assert.doesNotReject(() => dialog.getByRole('button', { name: new RegExp(`^${name}$`) }).waitFor());
  await dialog.getByRole('button', { name: '四角', exact: true }).click();
  await page.locator('canvas').click({ position: { x: 0, y: 0 } });
  await dialog.getByRole('button', { name: '文書へ反映', exact: true }).click();
  await page.waitForFunction(() => typeof window.webImageEditorResult === 'string' || typeof window.webImageEditorError === 'string');
  assert.equal(await page.evaluate(() => window.webImageEditorError), null);
  assert.match(await page.evaluate(() => window.webImageEditorResult), /^data:image\/png;base64,/);
});
