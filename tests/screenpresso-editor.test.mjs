import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { launchBrowser } from '../scripts/html-export/export.mjs';

test('Screenpresso iframe loads PNG/JPEG, annotates, cancels and returns the rendered pixels', { timeout: 120_000 }, async t => {
  const server = await createServer({ root: new URL('../web-platform/apps/web', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'), logLevel: 'error', server: { host: '127.0.0.1', port: 5181, strictPort: false } });
  await server.listen(); t.after(() => server.close());
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  for (const mime of ['image/png', 'image/jpeg']) {
    await page.evaluate(async mime => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 320, 240);
      window.originalImage = canvas.toDataURL(mime);
      document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'test-root' }));
      const reactModule = await import('/@id/react'); const React = reactModule.default ?? reactModule;
      const reactDomModule = await import('/@id/react-dom/client'); const createRoot = reactDomModule.createRoot ?? reactDomModule.default?.createRoot;
      const { WebImageEditor } = await import('/src/WebImageEditor.tsx');
      window.imageResult = null; window.imageError = null; window.imageClosed = false;
      window.testRoot?.unmount();
      window.testRoot = createRoot(document.getElementById('test-root'));
      window.testRoot.render(React.createElement(WebImageEditor, { source: window.originalImage, filename: mime === 'image/png' ? 'test.png' : 'test.jpg', onApply: value => { window.imageResult = value; }, onClose: () => { window.imageClosed = true; }, onError: value => { window.imageError = value; } }));
    }, mime);
    await page.getByRole('button', { name: '画像編集2', exact: true }).click();
    const apply = page.getByRole('button', { name: '反映', exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '反映' && !b.disabled));
    const inner = page.frameLocator('iframe[title="Screenpressoもどき画像編集"]');
    await inner.getByRole('button', { name: '四角', exact: true }).click();
    const canvas = inner.locator('#view');
    const bounds = await canvas.boundingBox(); assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .4);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .6, { steps: 5 }); await page.mouse.up();
    await apply.click();
    await page.waitForFunction(() => window.imageResult || window.imageError);
    assert.equal(await page.evaluate(() => window.imageError), null);
    assert.match(await page.evaluate(() => window.imageResult), /^data:image\/png;base64,/);
    const coloredPixels = await page.evaluate(async () => {
      const img = new Image(); img.src = window.imageResult; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240) count++;
      return count;
    });
    assert.ok(coloredPixels > 10, 'annotation changes the exported pixels');
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    assert.equal(await page.evaluate(() => window.imageClosed), true);
  }
  assert.deepEqual(errors, []);
});
