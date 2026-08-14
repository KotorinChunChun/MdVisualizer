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
await evaluate(`document.querySelector('.media-preview__close')?.click()`);
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

const report = { initialScreenshot, mermaidScreenshot, drawioScreenshot, mermaid, drawio };
if (!mermaid.opened || !mermaid.maximumFit || mermaid.extraScrollableCanvas) {
  throw new Error(`Mermaid maximum-fit verification failed: ${JSON.stringify(mermaid)}`);
}
if (mermaid.canvasBackground !== "rgb(255, 255, 255)" || mermaid.inlineBackground !== "rgb(255, 255, 255)") {
  throw new Error(`Mermaid white canvas verification failed: ${JSON.stringify(mermaid)}`);
}
if (!drawio.opened || !drawio.maximumFit || drawio.extraRightBottomWhitespace) {
  throw new Error(`draw.io popup verification failed: ${JSON.stringify(drawio)}`);
}
await writeFile(`${outputDirectory}/preview-report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
console.log(JSON.stringify(report));
