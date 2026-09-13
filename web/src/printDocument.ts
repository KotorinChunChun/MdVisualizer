import { exportHtmlInBrowser, type HtmlExportOptions, type HtmlExportResult } from '../../src/lib/htmlExport';
import { executePrintSession } from '../../src/lib/printSession';

export interface WebPrintDocumentOptions extends Omit<HtmlExportOptions, 'mode'> {
  /** Allows focused tests to supply an isolated DOM and printer. */
  runtime?: {
    document?: Document;
    exportHtml?: (options: HtmlExportOptions) => Promise<HtmlExportResult>;
    executePrint?: typeof executePrintSession;
  };
}

const PRINT_TIMEOUT_MS = 120_000;

function aborted(): Error { return new Error('印刷を中止しました。'); }

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function waitForFrameLoad(frame: HTMLIFrameElement, signal: AbortSignal): Promise<void> {
  return waitWithAbort(new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.addEventListener('error', () => reject(new Error('印刷用文書を読み込めません。')), { once: true });
  }), signal);
}

async function waitForPrintAssets(frame: HTMLIFrameElement, signal: AbortSignal): Promise<void> {
  const document = frame.contentDocument;
  if (!document) throw new Error('印刷用文書を初期化できません。');
  const fonts = document.fonts?.ready ?? Promise.resolve();
  const images = [...document.images].map(async image => {
    if (typeof image.decode === 'function') await image.decode();
  });
  await waitWithAbort(Promise.all([fonts, ...images]).then(() => undefined), signal);
}

/**
 * Renders a complete static export in an isolated same-origin iframe and opens
 * the platform print UI only after every embedded image and font is ready.
 */
export async function printWebDocument(options: WebPrintDocumentOptions): Promise<HtmlExportResult> {
  if (options.signal?.aborted) throw aborted();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), PRINT_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const signal = controller.signal;
  const host = options.runtime?.document ?? document;
  const exportHtml = options.runtime?.exportHtml ?? exportHtmlInBrowser;
  const printSession = options.runtime?.executePrint ?? executePrintSession;
  let frame: HTMLIFrameElement | undefined;
  let printing = false;
  const cleanup = () => { frame?.remove(); frame = undefined; };
  const cancelBeforePrint = () => { if (!printing) cleanup(); };
  signal.addEventListener('abort', cancelBeforePrint, { once: true });
  try {
    options.onProgress?.('印刷用の全文・図・表を組み立てています');
    const result = await waitWithAbort(exportHtml({
      markdown: options.markdown,
      title: options.title,
      theme: options.theme,
      css: options.css,
      baseDir: options.baseDir,
      readAsset: options.readAsset,
      drawioViewer: options.drawioViewer,
      mode: 'static',
      signal,
      onProgress: options.onProgress,
    }), signal);
    signal.throwIfAborted();
    options.onProgress?.('印刷用の画像とフォントを確定しています');
    frame = host.createElement('iframe');
    frame.title = '印刷用文書';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:960px;border:0;opacity:0;pointer-events:none';
    frame.srcdoc = result.html;
    host.body.append(frame);
    await waitForFrameLoad(frame, signal);
    await waitForPrintAssets(frame, signal);
    signal.throwIfAborted();
    const printWindow = frame.contentWindow;
    if (!printWindow) throw new Error('印刷用ウィンドウを初期化できません。');
    printing = true;
    options.onProgress?.('システムの印刷画面を開いています');
    await printSession({ print: () => printWindow.print(), events: printWindow, restore: cleanup });
    return result;
  } catch (error) {
    if (signal.aborted) throw new Error(options.signal?.aborted ? '印刷を中止しました。' : '印刷用文書の準備がタイムアウトしました。');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
    signal.removeEventListener('abort', cancelBeforePrint);
    cleanup();
  }
}
