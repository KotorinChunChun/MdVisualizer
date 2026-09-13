import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { build } from 'vite';
import { chromium } from 'playwright-core';
import { boundedFile, createAssetReader, decodeText, fetchBytes, LIMITS, saveHtml, validateDestination } from './io.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let bundlePromise;
export function browserBundle() {
  return bundlePromise ??= build({ configFile: false, root, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, build: { write: false, minify: true, target: 'es2022', lib: { entry: path.join(root, 'scripts/html-export/browser.tsx'), name: 'HtmlExport', formats: ['iife'] }, rollupOptions: { output: { inlineDynamicImports: true } } } }).then(result => {
    const output = Array.isArray(result) ? result[0].output : result.output;
    return output.find(item => item.type === 'chunk' && item.isEntry).code;
  }).catch(error => { bundlePromise = undefined; throw error; });
}

export async function launchBrowser(executablePath) {
  if (executablePath) return chromium.launch({ executablePath, headless: true });
  if (process.platform === 'win32') {
    for (const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) {
      try { await access(candidate); return await chromium.launch({ executablePath: candidate, headless: true }); } catch { /* 次のインストール先を確認する。 */ }
    }
  }
  try { return await chromium.launch({ headless: true }); }
  catch { throw new Error('生成用Chromiumが見つかりません。--browser でEdge/Chromeの実行ファイルを指定してください。'); }
}

export async function exportHtml({ markdown, baseDir = process.cwd(), output, title = '文書', theme = 'dark', mode = 'static', css = '', force = false, allowRemote = false, drawioViewer, browserPath, signal, protectedPaths = new Set(), onProgress = () => {} }) {
  if (!['static', 'interactive'].includes(mode)) throw new Error('出力モードはstaticまたはinteractiveを指定してください。');
  if (!['dark', 'light', 'github', 'solarized', 'nord'].includes(theme)) throw new Error('非対応のテーマです。');
  if (Buffer.byteLength(markdown) > LIMITS.document) throw new Error('Markdownの容量上限を超えました。');
  await validateDestination(output, { force, protectedPaths });
  const timeout = AbortSignal.timeout(LIMITS.timeout);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  combined.throwIfAborted();
  onProgress('描画エンジンを準備しています');
  const code = await browserBundle();
  combined.throwIfAborted();
  const reader = createAssetReader({ baseDir: path.resolve(baseDir), allowRemote, signal: combined });
  const browser = await launchBrowser(browserPath);
  const abort = () => { void browser.close().catch(() => {}); };
  combined.addEventListener('abort', abort, { once: true });
  try {
    combined.throwIfAborted();
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.setDefaultTimeout(30_000);
    await page.exposeBinding('__readAsset', async (_, source, base) => {
      try { return await reader.read(source, base); }
      catch (error) { throw new Error(`資産を埋め込めません (${String(error.message).replace(/(?:https?:\/\/|file:)[^\s)]+/gi, '[参照先]')})`); }
    });
    let viewerPromise;
    await page.exposeBinding('__drawioViewer', () => viewerPromise ??= (async () => {
      if (drawioViewer) return decodeText(await boundedFile(drawioViewer));
      if (!allowRemote) throw new Error('draw.ioの描画には --allow-remote または --drawio-viewer が必要です。');
      return decodeText((await fetchBytes('https://viewer.diagrams.net/js/viewer-static.min.js', { signal: combined })).bytes);
    })());
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    await page.addScriptTag({ content: code });
    if (!await page.evaluate(() => Boolean(window.__htmlExport))) throw new Error(`描画エンジンを初期化できません: ${pageErrors.join('; ')}`);
    onProgress('本文・図・画像を描画しています');
    const statistics = await page.evaluate(options => window.__htmlExport.prepare(options), { markdown, title, theme, css });
    // 置換で一覧の添字が変わるため、各図の要素自体を固定しておく。
    const diagrams = await page.locator('[data-export-raster]').elementHandles();
    for (const [index, diagram] of diagrams.entries()) {
      combined.throwIfAborted();
      onProgress(`図を画像化しています (${index + 1}/${diagrams.length})`);
      const box = await diagram.boundingBox();
      if (!box || box.width < 1 || box.height < 1 || box.width > 8192 || box.height > 8192 || box.width * box.height * 4 > 16_000_000) throw new Error('図の画像化サイズが上限を超えたか、寸法を確定できません。');
      const png = await diagram.screenshot({ type: 'png', animations: 'disabled' });
      await diagram.evaluate((element, data) => window.__htmlExport.replaceRaster(element, data), `data:image/png;base64,${png.toString('base64')}`);
    }
    const html = await page.evaluate(({ mode, nonce }) => window.__htmlExport.finish(mode, nonce), { mode, nonce: randomBytes(24).toString('base64') });
    combined.throwIfAborted();
    onProgress('単一HTMLを保存しています');
    for (const protectedPath of reader.protectedPaths) protectedPaths.add(protectedPath);
    const saved = await saveHtml(output, html, { force, protectedPaths, signal: combined });
    return { output: saved, mode, bytes: Buffer.byteLength(html), ...statistics, rasterized: diagrams.length };
  } catch (error) {
    if (combined.aborted) throw new Error(signal?.aborted ? '出力を中止しました。' : '出力がタイムアウトしました。');
    throw error;
  } finally {
    combined.removeEventListener('abort', abort);
    await browser.close();
  }
}
