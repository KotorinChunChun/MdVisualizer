import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.argv[2] ?? 9333);
const outputDirectory = process.argv[3];
if (!outputDirectory) throw new Error("Output directory is required.");
await mkdir(outputDirectory, { recursive: true });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let targets = [];
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    if (targets.length > 0) break;
  } catch {
    // WebView2 exposes the endpoint shortly after the native window appears.
  }
  await delay(100);
}
const target = targets.find((candidate) => candidate.type === "page" && (
  candidate.url.startsWith("tauri://") || candidate.url.startsWith("http://tauri.localhost/")
));
if (!target) throw new Error(`Tauri page target not found on port ${port}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? "Runtime evaluation failed");
  return response.result.value;
};
const screenshot = async (filename) => {
  const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `${outputDirectory}/${filename}`;
  await writeFile(path, Buffer.from(capture.data, "base64"));
  return path;
};

await command("Page.enable");
await command("Runtime.enable");
await evaluate(`new Promise((resolve) => {
  const target = [...document.querySelectorAll('.tab[title]')].find((tab) => /[\\\\/]v0\.0\.10-editing\.md$/i.test(tab.title));
  target?.click();
  setTimeout(resolve, 150);
})`);
await evaluate(`document.querySelector('.media-preview__close')?.click()`);
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.document-actions button')].find((candidate) => candidate.textContent.trim() === '差分');
  if (button?.getAttribute('aria-pressed') === 'true') button.click();
  [...document.querySelectorAll('.editor-mode-segments button')].find((candidate) => candidate.textContent.trim() === '閲覧のみ')?.click();
})()`);
await delay(150);
const documentReady = await evaluate(`new Promise((resolve) => {
  const deadline = Date.now() + 20000;
  const poll = () => {
    const mermaid = document.querySelector('.mermaid-container');
    const drawio = document.querySelector('.drawio-block');
    if (mermaid && drawio) resolve(true);
    else if (Date.now() >= deadline) resolve(false);
    else setTimeout(poll, 100);
  };
  poll();
})`);
if (!documentReady) throw new Error("Mermaid or draw.io block did not appear within 20 seconds");

const viewContext = await evaluate(`new Promise((resolve) => {
  const target = document.querySelector('.markdown-body p[data-source-line]');
  const previewButton = [...document.querySelectorAll('.editor-mode-segments button')].find((candidate) => candidate.textContent.trim() === '閲覧のみ');
  if (!target || !previewButton) { resolve({ ok: false, reason: '対象行または閲覧のみボタンがありません' }); return; }
  const line = Number(target.dataset.sourceLine);
  target.scrollIntoView({ block: 'center' });
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 300 }));
  setTimeout(() => {
    const stayedPreview = previewButton.getAttribute('aria-pressed') === 'true' && !document.querySelector('.markdown-editor');
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
    setTimeout(() => {
      const labels = [...document.querySelectorAll('.preview-context-menu [role=menuitem]')].map((button) => button.textContent.trim());
      const lineSelect = [...document.querySelectorAll('.preview-context-menu [role=menuitem]')].find((button) => button.textContent.trim() === '行選択');
      lineSelect?.click();
      setTimeout(() => {
        const selectedText = window.getSelection()?.toString().trim() ?? '';
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
        setTimeout(() => {
          const edit = [...document.querySelectorAll('.preview-context-menu [role=menuitem]')].find((button) => button.textContent.trim() === '編集');
          edit?.click();
          const deadline = Date.now() + 5000;
          const poll = () => {
            const highlighted = document.querySelector('.is-editor-current-line');
            if (document.querySelector('.markdown-editor') && highlighted) {
              resolve({ ok: true, stayedPreview, labels, selectedText, requestedLine: line, highlightedLine: Number(highlighted.dataset.sourceLine) });
            } else if (Date.now() >= deadline) resolve({ ok: false, stayedPreview, labels, selectedText, requestedLine: line, reason: '編集切替または現在行強調が完了しませんでした' });
            else setTimeout(poll, 50);
          };
          poll();
        }, 50);
      }, 50);
    }, 50);
  }, 150);
})`);
const viewContextScreenshot = await screenshot("view-context-menu-edit.png");
if (!viewContext.ok || !viewContext.stayedPreview || !viewContext.selectedText
  || JSON.stringify(viewContext.labels) !== JSON.stringify(['マークダウンでコピー', 'プレーンテキストでコピー', '編集', '下にブロックを追加', '行選択', 'ブロック全体を選択', 'すべて選択'])
  || viewContext.highlightedLine > viewContext.requestedLine) {
  throw new Error(`View context verification failed: ${JSON.stringify(viewContext)}`);
}
await evaluate(`new Promise((resolve) => {
  [...document.querySelectorAll('.editor-mode-segments button')].find((candidate) => candidate.textContent.trim() === '閲覧')?.click();
  setTimeout(resolve, 150);
})`);

const structuredList = await evaluate(`(() => {
  const root = [...document.querySelectorAll('.markdown-body ol')].find((list) =>
    [...list.children].some((child) => child.tagName === 'LI' && child.textContent.includes('リスト親'))
  );
  if (!root) return { found: false };
  root.scrollIntoView({ block: 'center', inline: 'nearest' });
  const directItems = [...root.children].filter((child) => child.tagName === 'LI');
  const first = directItems[0];
  const standardRoot = [...document.querySelectorAll('.markdown-body ol')].find((list) =>
    [...list.children].some((child) => child.tagName === 'LI' && child.textContent.includes('親A'))
  );
  const standardItems = [...(standardRoot?.children ?? [])].filter((child) => child.tagName === 'LI');
  const orderedDepth = first?.querySelector(':scope > ol > li > ol > li') ? 3 : 0;
  const bullets = [...(first?.querySelectorAll('ul') ?? [])].map((list) => ({
    text: list.querySelector(':scope > li > p')?.textContent ?? list.querySelector(':scope > li')?.firstChild?.textContent ?? '',
    markerClass: [...list.classList].find((name) => name.startsWith('markdown-list-marker-')) ?? '',
  }));
  return {
    found: true,
    directItems: directItems.length,
    orderedDepth,
    bullets,
    joinedOrderedText: [...first.querySelectorAll('p')].some((paragraph) => paragraph.textContent.includes('1. リスト孫')),
    standardDirectItems: standardItems.length,
    standardChildItems: standardItems[0]?.querySelectorAll(':scope > ol > li').length ?? 0,
    standardJoinedText: [...(standardItems[0]?.querySelectorAll('p') ?? [])].some((paragraph) => paragraph.textContent.includes('1. 子A-1')),
  };
})()`);
const structuredListScreenshot = await screenshot("structured-list.png");
const expectedMarkerClasses = [
  "markdown-list-marker-odd",
  "markdown-list-marker-even",
  "markdown-list-marker-odd",
  "markdown-list-marker-even",
];
if (!structuredList.found || structuredList.directItems !== 2 || structuredList.orderedDepth !== 3
  || structuredList.joinedOrderedText || structuredList.standardDirectItems !== 2
  || structuredList.standardChildItems !== 2 || structuredList.standardJoinedText
  || JSON.stringify(structuredList.bullets.map((item) => item.markerClass)) !== JSON.stringify(expectedMarkerClasses)) {
  throw new Error(`Structured list verification failed: ${JSON.stringify(structuredList)}`);
}

await evaluate(`document.querySelector('.mermaid-container')?.scrollIntoView({ block: 'center', inline: 'center' })`);
const mermaidReady = await evaluate(`new Promise((resolve) => {
  const deadline = Date.now() + 20000;
  const poll = () => {
    if (document.querySelector('.mermaid-block svg')) resolve(true);
    else if (Date.now() >= deadline) resolve(false);
    else setTimeout(poll, 100);
  };
  poll();
})`);
if (!mermaidReady) throw new Error("Mermaid preview did not render within 20 seconds");

const initialScreenshot = await screenshot("initial-window.png");
const mermaid = await evaluate(`new Promise((resolve) => {
  const block = document.querySelector('.mermaid-block');
  block.scrollIntoView({ block: 'center', inline: 'center' });
  block.click();
  setTimeout(() => {
    const modal = document.querySelector('.media-preview');
    const viewport = modal?.querySelector('.media-preview__viewport');
    const stage = modal?.querySelector('.media-preview__stage');
    const transform = modal?.querySelector('.media-preview__transform');
    const canvas = modal?.querySelector('.media-preview__svg');
    const rect = transform?.getBoundingClientRect();
    const fillsWidth = !!rect && Math.abs(rect.width - viewport.clientWidth) <= 3;
    const fillsHeight = !!rect && Math.abs(rect.height - viewport.clientHeight) <= 3;
    resolve({
      opened: !!modal,
      canvasBackground: canvas ? getComputedStyle(canvas).backgroundColor : null,
      viewport: viewport ? { width: viewport.clientWidth, height: viewport.clientHeight } : null,
      media: rect ? { width: rect.width, height: rect.height } : null,
      fillsWidth,
      fillsHeight,
      maximumFit: fillsWidth || fillsHeight,
      stage: stage ? { width: stage.scrollWidth, height: stage.scrollHeight } : null,
      extraScrollableCanvas: !!stage && (stage.scrollWidth > viewport.clientWidth + 3 || stage.scrollHeight > viewport.clientHeight + 3),
      inlineBackground: getComputedStyle(block).backgroundColor,
    });
  }, 300);
})`);
const mermaidScreenshot = await screenshot("mermaid-popup.png");
await evaluate(`document.querySelector('.media-preview__close')?.click()`);

await evaluate(`document.querySelector('.drawio-block')?.scrollIntoView({ block: 'center', inline: 'center' })`);
const drawioReady = await evaluate(`new Promise((resolve) => {
  const deadline = Date.now() + 20000;
  const poll = () => {
    const zoom = document.querySelector('.drawio-block__zoom');
    if (zoom) resolve(true);
    else if (Date.now() >= deadline) resolve(false);
    else setTimeout(poll, 100);
  };
  poll();
})`);
if (!drawioReady) throw new Error("Cropped draw.io SVG did not appear within 20 seconds");
const drawio = await evaluate(`new Promise((resolve) => {
  const zoom = document.querySelector('.drawio-block__zoom');
  const inlineSvg = zoom.querySelector('svg');
  const viewBox = inlineSvg.viewBox.baseVal;
  const bounds = (inlineSvg.querySelector(':scope > g') ?? inlineSvg).getBBox();
  const margins = {
    left: bounds.x - viewBox.x,
    top: bounds.y - viewBox.y,
    right: viewBox.x + viewBox.width - bounds.x - bounds.width,
    bottom: viewBox.y + viewBox.height - bounds.y - bounds.height,
  };
  zoom.scrollIntoView({ block: 'center', inline: 'center' });
  zoom.click();
  setTimeout(() => {
    const modal = document.querySelector('.media-preview');
    const viewport = modal?.querySelector('.media-preview__viewport');
    const transform = modal?.querySelector('.media-preview__transform');
    const rect = transform?.getBoundingClientRect();
    const fillsWidth = !!rect && Math.abs(rect.width - viewport.clientWidth) <= 3;
    const fillsHeight = !!rect && Math.abs(rect.height - viewport.clientHeight) <= 3;
    resolve({
      opened: !!modal,
      margins,
      extraRightBottomWhitespace: margins.right > 32 || margins.bottom > 32,
      maximumFit: fillsWidth || fillsHeight,
      viewport: viewport ? { width: viewport.clientWidth, height: viewport.clientHeight } : null,
      media: rect ? { width: rect.width, height: rect.height } : null,
    });
  }, 300);
})`);
const drawioScreenshot = await screenshot("drawio-popup.png");
await evaluate(`document.querySelector('.media-preview__close')?.click()`);

const diffPreview = await evaluate(`new Promise((resolve) => {
  const startedAt = performance.now();
  const button = [...document.querySelectorAll('.document-actions button')].find((candidate) => candidate.textContent.trim() === '差分');
  if (!button) { resolve({ opened: false, reason: '差分ボタンがありません' }); return; }
  button.click();
  const deadline = Date.now() + 20000;
  const poll = () => {
    const workspace = document.querySelector('.document-diff-workspace');
    const panes = workspace?.querySelectorAll('.document-diff__pane').length ?? 0;
    const renderedPanes = workspace?.querySelectorAll('.document-diff__rendered').length ?? 0;
    if (workspace && panes > 0 && renderedPanes === panes) {
      resolve({
        opened: true,
        mode: workspace.querySelector('.document-diff__panes--three-way') ? 'three-way' : 'two-way',
        panes,
        renderedPanes,
        summary: workspace.querySelector('.document-diff-workspace__header small')?.textContent ?? '',
        interactiveDiagrams: workspace.querySelectorAll('.mermaid-container, .drawio-block').length,
        durationMs: performance.now() - startedAt,
      });
    } else if (Date.now() >= deadline) resolve({ opened: false, reason: '20秒以内に開きませんでした' });
    else setTimeout(poll, 100);
  };
  poll();
})`);
const diffRenderedScreenshot = await screenshot("diff-rendered.png");

const diffCode = await evaluate(`new Promise((resolve) => {
  const startedAt = performance.now();
  const button = [...document.querySelectorAll('.editor-mode-segments button')].find((candidate) => candidate.textContent.trim() === '編集のみ');
  button?.click();
  const deadline = Date.now() + 5000;
  const poll = () => {
    const workspace = document.querySelector('.document-diff-workspace');
    const panes = workspace?.querySelectorAll('.document-diff__pane').length ?? 0;
    const codePanes = workspace?.querySelectorAll('.document-diff__code, .document-diff__pane > .markdown-editor').length ?? 0;
    if ((panes > 0 && codePanes === panes) || Date.now() >= deadline) {
      resolve({
        panes,
        codePanes,
        highlightedBlocks: document.querySelectorAll('.markdown-diff-line').length,
        durationMs: performance.now() - startedAt,
      });
    } else setTimeout(poll, 50);
  };
  poll();
})`);
const diffCodeScreenshot = await screenshot("diff-code.png");

const diffSplit = await evaluate(`new Promise((resolve) => {
  const startedAt = performance.now();
  const button = [...document.querySelectorAll('.editor-mode-segments button')].find((candidate) => candidate.textContent.trim() === '編集／閲覧');
  button?.click();
  const deadline = Date.now() + 5000;
  const poll = () => {
    const workspace = document.querySelector('.document-diff-workspace');
    const panes = workspace?.querySelectorAll('.document-diff__pane').length ?? 0;
    const codePanes = workspace?.querySelectorAll('.document-diff__code, .document-diff__pane > .markdown-editor').length ?? 0;
    const renderedPanes = workspace?.querySelectorAll('.document-diff__rendered').length ?? 0;
    if ((panes === 4 && codePanes === 2 && renderedPanes === 2) || Date.now() >= deadline) {
      resolve({ panes, codePanes, renderedPanes, interactiveDiagrams: workspace?.querySelectorAll('.mermaid-container, .drawio-block').length ?? 0, durationMs: performance.now() - startedAt });
    } else setTimeout(poll, 50);
  };
  poll();
})`);
const diffSplitScreenshot = await screenshot("diff-split.png");
const diffScroll = await evaluate(`new Promise((resolve) => {
  const scrollers = [...document.querySelectorAll('.document-diff__code, .document-diff__rendered, .document-diff-workspace .cm-scroller')];
  const source = scrollers.find((element) => element.scrollHeight - element.clientHeight > 20);
  if (!source) { resolve({ synced: false, reason: 'スクロール可能なDIFFペインがありません' }); return; }
  const maximum = source.scrollHeight - source.clientHeight;
  source.scrollTop = maximum * 0.6;
  source.dispatchEvent(new Event('scroll'));
  setTimeout(() => {
    const ratios = scrollers.filter((element) => element.scrollHeight - element.clientHeight > 20).map((element) => ({
      className: element.className,
      ratio: element.scrollTop / (element.scrollHeight - element.clientHeight),
    }));
    resolve({ synced: ratios.length >= 2 && ratios.every((item) => Math.abs(item.ratio - 0.6) < 0.08), ratios });
  }, 100);
})`);

const diffClosed = await evaluate(`new Promise((resolve) => {
  const previewButton = [...document.querySelectorAll('.editor-mode-segments button')].find((candidate) => candidate.textContent.trim() === '閲覧のみ');
  previewButton?.click();
  const button = [...document.querySelectorAll('.document-actions button')].find((candidate) => candidate.textContent.trim() === '差分');
  button?.click();
  const deadline = Date.now() + 2000;
  const poll = () => {
    if (!document.querySelector('.document-diff-workspace') && button?.getAttribute('aria-pressed') === 'false') resolve(true);
    else if (Date.now() >= deadline) resolve(false);
    else setTimeout(poll, 25);
  };
  poll();
})`);

const report = { initialScreenshot, structuredListScreenshot, mermaidScreenshot, drawioScreenshot, viewContextScreenshot, diffCodeScreenshot, diffRenderedScreenshot, diffSplitScreenshot, structuredList, mermaid, drawio, viewContext, diffPreview, diffCode, diffSplit, diffScroll, diffClosed };
if (!mermaid.opened || !mermaid.maximumFit || mermaid.extraScrollableCanvas) {
  throw new Error(`Mermaid maximum-fit verification failed: ${JSON.stringify(mermaid)}`);
}
if (mermaid.canvasBackground !== "rgb(255, 255, 255)" || mermaid.inlineBackground !== "rgb(255, 255, 255)") {
  throw new Error(`Mermaid white canvas verification failed: ${JSON.stringify(mermaid)}`);
}
if (!drawio.opened || !drawio.maximumFit || drawio.extraRightBottomWhitespace) {
  throw new Error(`draw.io popup verification failed: ${JSON.stringify(drawio)}`);
}
if (!diffPreview.opened || ![2, 3].includes(diffPreview.panes) || diffPreview.interactiveDiagrams !== 0 || diffPreview.durationMs > 5000
  || diffCode.codePanes !== diffCode.panes || diffCode.durationMs > 5000
  || diffSplit.panes !== 4 || diffSplit.codePanes !== 2 || diffSplit.renderedPanes !== 2 || diffSplit.interactiveDiagrams !== 0 || diffSplit.durationMs > 5000
  || !diffScroll.synced
  || !diffClosed) {
  throw new Error(`Document diff verification failed: ${JSON.stringify({ diffPreview, diffCode, diffSplit, diffScroll, diffClosed })}`);
}
await writeFile(`${outputDirectory}/preview-report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
console.log(JSON.stringify(report));
