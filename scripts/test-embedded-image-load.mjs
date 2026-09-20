import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const port = Number(process.argv[2] ?? 9333);
const output = resolve(process.argv[3] ?? "dev/history/v0.0.18.4/logs/embedded-images-load");
await mkdir(output, { recursive: true });
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
if (!target) throw new Error(`WebView2のページがポート${port}にありません。`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => { socket.addEventListener("open", resolvePromise, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); });
const evaluate = (expression) => new Promise((resolvePromise, reject) => { const requestId = ++id; pending.set(requestId, { resolve: resolvePromise, reject }); socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
await evaluate("document.querySelector('.tab[title*=" + JSON.stringify("v0.0.18.4-100-embedded-images.md") + "]')?.click()");
const result = await evaluate(`new Promise((resolve) => {
  const started = performance.now();
  const waitForImages = () => {
    const preview = document.querySelector('.preview-container');
    const images = [...(preview?.querySelectorAll('.markdown-body img') ?? [])];
    const pending = images.filter((image) => !image.complete).length;
    if (images.length === 100 && pending === 0) {
      const before = performance.now();
      if (preview) { preview.scrollTop = preview.scrollHeight; preview.dispatchEvent(new Event('scroll')); preview.scrollTop = 0; preview.dispatchEvent(new Event('scroll')); }
      resolve({ imageCount: images.length, brokenImages: images.filter((image) => image.naturalWidth === 0).length, loadMs: Math.round(performance.now() - started), scrollMs: Math.round(performance.now() - before), scrollHeight: preview?.scrollHeight ?? 0 });
    } else if (performance.now() - started > 60000) resolve({ imageCount: images.length, pendingImages: pending, timeout: true });
    else setTimeout(waitForImages, 50);
  };
  const preview = document.querySelector('.preview-container');
  const images = [...(preview?.querySelectorAll('.markdown-body img') ?? [])];
  images.forEach((image) => image.scrollIntoView({ block: 'center', inline: 'nearest' }));
  setTimeout(waitForImages, 250);
})`);
await writeFile(resolve(output, "summary.json"), JSON.stringify({ port, ...result }, null, 2));
console.log(JSON.stringify(result));
if (result.timeout || result.imageCount !== 100 || result.brokenImages > 0) process.exitCode = 1;
