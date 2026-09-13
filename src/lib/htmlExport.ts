import { htmlExportBrowserPayload } from '../generated/htmlExportBrowserPayload.generated';

export type HtmlExportMode = 'static' | 'interactive';
export interface HtmlExportAsset { base: string; mime: string; text?: string; data: string }
export interface HtmlExportOptions {
  markdown: string;
  theme: string;
  title: string;
  css?: string;
  mode?: HtmlExportMode;
  baseDir?: string;
  readAsset: (source: string, base?: string) => Promise<HtmlExportAsset>;
  drawioViewer?: () => Promise<string>;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
export interface HtmlExportResult {
  html: string;
  mode: HtmlExportMode;
  bytes: number;
  items: number;
  diagrams: number;
  tables: number;
  rasterized: number;
}

interface ExportWindow extends Window {
  __readAsset?: (source: string, base?: string) => Promise<HtmlExportAsset>;
  __drawioViewer?: () => Promise<string>;
  __htmlExport?: {
    prepare: (options: { markdown: string; title: string; theme: string; css: string }) => Promise<Omit<HtmlExportResult, 'html' | 'mode' | 'bytes' | 'rasterized'>>;
    replaceRaster: (element: Element, data: string) => void;
    finish: (mode: HtmlExportMode, nonce: string) => string;
  };
}

const LIMITS = { document: 8 * 1024 * 1024, asset: 32 * 1024 * 1024, total: 128 * 1024 * 1024, html: 128 * 1024 * 1024, rasterPixels: 16_000_000 };
const DRAWIO_VIEWER_URL = 'https://viewer.diagrams.net/js/viewer-static.min.js';
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const dataLength = (data: string) => {
  const comma = data.indexOf(',');
  if (comma < 0) return byteLength(data);
  const body = data.slice(comma + 1).replace(/\s/g, '');
  return /;base64,/i.test(data.slice(0, comma + 1)) ? Math.floor(body.length * 3 / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0) : byteLength(decodeURIComponent(body));
};
const nonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
};

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('出力を中止しました。'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('出力を中止しました。'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function rasterize(element: Element): Promise<string> {
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.height < 1 || box.width > 8192 || box.height > 8192 || box.width * box.height * 4 > LIMITS.rasterPixels) {
    return Promise.reject(new Error('図の画像化サイズが上限を超えたか、寸法を確定できません。'));
  }
  const svg = element.namespaceURI === 'http://www.w3.org/2000/svg' && element.localName === 'svg'
    ? element as SVGSVGElement
    : element.querySelector('svg');
  if (!svg) return Promise.reject(new Error('PNG化するSVG図が見つかりません。'));
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(Math.ceil(box.width)));
  copy.setAttribute('height', String(Math.ceil(box.height)));
  const source = new XMLSerializer().serializeToString(copy);
  const bytes = new TextEncoder().encode(source);
  const url = `data:image/svg+xml;base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`;
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(2, Math.sqrt(LIMITS.rasterPixels / (box.width * box.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(box.width * scale)); canvas.height = Math.max(1, Math.floor(box.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PNG用キャンバスを初期化できません。');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('SVG図をPNGへ変換できません。'));
    image.src = url;
  });
}

function iframeDocument() {
  // payloadは自リポジトリでビルドしたIIFEのみ。入力Markdownはsrcdocへ補間しない。
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${htmlExportBrowserPayload.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

async function loadDrawioViewer(signal: AbortSignal) {
  const response = await waitWithAbort(fetch(DRAWIO_VIEWER_URL, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }), signal);
  if (!response.ok) throw new Error('draw.ioの描画資産を取得できません。');
  const bytes = await waitWithAbort(response.arrayBuffer(), signal);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('draw.ioの描画資産が上限を超えています。');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function exportHtmlInBrowser(options: HtmlExportOptions): Promise<HtmlExportResult> {
  if (!['static', 'interactive'].includes(options.mode ?? 'static')) throw new Error('出力モードはstaticまたはinteractiveを指定してください。');
  if (byteLength(options.markdown) > LIMITS.document) throw new Error('Markdownの容量上限を超えました。');
  if (options.signal?.aborted) throw new Error('出力を中止しました。');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  const signal = controller.signal;
  signal.throwIfAborted();
  let assetBytes = 0;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); frame.setAttribute('aria-hidden', 'true'); frame.title = 'HTML出力用レンダラー';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:960px;border:0;opacity:0;pointer-events:none'; frame.srcdoc = iframeDocument();
  document.body.append(frame);
  const remove = () => frame.remove();
  const abort = () => remove();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await waitWithAbort(new Promise<void>((resolve, reject) => { frame.addEventListener('load', () => resolve(), { once: true }); frame.addEventListener('error', () => reject(new Error('HTML出力用レンダラーを読み込めません。')), { once: true }); }), signal);
    signal.throwIfAborted();
    const win = frame.contentWindow as ExportWindow | null;
    if (!win?.__htmlExport) throw new Error('HTML出力用レンダラーを初期化できません。');
    win.__readAsset = async (source, base) => {
      signal.throwIfAborted();
      const asset = await waitWithAbort(options.readAsset(source, base ?? options.baseDir), signal);
      const bytes = Math.max(dataLength(asset.data), asset.text === undefined ? 0 : byteLength(asset.text));
      if (bytes > LIMITS.asset) throw new Error('資産単体の容量上限を超えました。');
      assetBytes += bytes;
      if (assetBytes > LIMITS.total) throw new Error('資産合計の容量上限を超えました。');
      return asset;
    };
    let viewer: Promise<string> | undefined;
    win.__drawioViewer = () => viewer ??= options.drawioViewer ? waitWithAbort(options.drawioViewer(), signal) : loadDrawioViewer(signal);
    options.onProgress?.('本文・図・画像を描画しています');
    const statistics = await waitWithAbort(win.__htmlExport.prepare({ markdown: options.markdown, title: options.title, theme: options.theme, css: options.css ?? '' }), signal);
    const diagrams = [...frame.contentDocument!.querySelectorAll('[data-export-raster]')];
    for (const [index, diagram] of diagrams.entries()) {
      signal.throwIfAborted();
      options.onProgress?.(`図を画像化しています (${index + 1}/${diagrams.length})`);
      win.__htmlExport.replaceRaster(diagram, await waitWithAbort(rasterize(diagram), signal));
    }
    signal.throwIfAborted();
    options.onProgress?.('単一HTMLを仕上げています');
    const html = win.__htmlExport.finish(options.mode ?? 'static', nonce());
    if (byteLength(html) > LIMITS.html) throw new Error('完成HTMLの容量上限を超えました。');
    return { html, mode: options.mode ?? 'static', bytes: byteLength(html), ...statistics, rasterized: diagrams.length };
  } catch (error) {
    if (signal.aborted) throw new Error(options.signal?.aborted ? '出力を中止しました。' : '出力がタイムアウトしました。');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', externalAbort);
    signal.removeEventListener('abort', abort);
    remove();
  }
}

export function downloadHtml(html: string, filename: string) {
  const safeFilename = filename.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'document.html';
  const name = safeFilename.toLowerCase().endsWith('.html') ? safeFilename : `${safeFilename}.html`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
