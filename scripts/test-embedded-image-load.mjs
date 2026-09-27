import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const positional = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const port = Number(positional[0] ?? 9333);
const output = resolve(positional[1] ?? "dev/history/v0.0.18.4/logs/embedded-images-load");
const baselinePath = resolve(process.argv.find((argument) => argument.startsWith("--baseline="))?.slice("--baseline=".length) ?? "tests/performance/baselines/embedded-images-load.json");
const updateBaseline = process.argv.includes("--update-baseline");
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
      const loadMs = Math.round(performance.now() - started);
      const positions = preview ? Array.from({ length: 9 }, (_, index) => (preview.scrollHeight - preview.clientHeight) * index / 8) : [];
      const scrollStarted = performance.now();
      let previousFrame = performance.now();
      let maxFrameMs = 0;
      let frames = 0;
      const nextFrame = () => new Promise((done) => requestAnimationFrame(() => {
        const now = performance.now();
        maxFrameMs = Math.max(maxFrameMs, now - previousFrame);
        previousFrame = now;
        frames += 1;
        done();
      }));
      (async () => {
        for (const position of positions) {
          if (preview) preview.scrollTop = position;
          await nextFrame();
        }
        if (preview) preview.scrollTop = 0;
        await nextFrame();
        resolve({ imageCount: images.length, brokenImages: images.filter((image) => image.naturalWidth === 0).length, loadMs, scrollSweepMs: Math.round(performance.now() - scrollStarted), maxFrameMs: Math.round(maxFrameMs * 10) / 10, frames, scrollHeight: preview?.scrollHeight ?? 0 });
      })();
    } else if (performance.now() - started > 60000) resolve({
      imageCount: images.length,
      pendingImages: pending,
      brokenImages: images.filter((image) => image.complete && image.naturalWidth === 0).length,
      samples: images.slice(0, 3).map((image) => ({ src: image.getAttribute('src')?.slice(0, 80), complete: image.complete, naturalWidth: image.naturalWidth, currentSrc: image.currentSrc?.slice(0, 80) })),
      timeout: true,
    });
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

if (!result.timeout && result.imageCount === 100 && result.brokenImages === 0) {
  const metrics = { loadMs: result.loadMs, scrollSweepMs: result.scrollSweepMs, maxFrameMs: result.maxFrameMs };
  if (updateBaseline) {
    await mkdir(resolve(baselinePath, ".."), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify({ schemaVersion: 1, fixture: "samples/v0.0.18.4-100-embedded-images.md", imageCount: 100, metrics, limits: { loadMs: { multiplier: 1.5, allowanceMs: 250 }, scrollSweepMs: { multiplier: 1.5, allowanceMs: 100 }, maxFrameMs: { multiplier: 1.75, allowanceMs: 8 } } }, null, 2)}\n`, "utf8");
    console.log(`性能基準を更新しました: ${baselinePath}`);
  } else {
    try {
      const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
      const regressions = Object.entries(baseline.limits).flatMap(([key, limit]) => {
        const actual = metrics[key];
        const allowed = baseline.metrics[key] * limit.multiplier + limit.allowanceMs;
        return actual > allowed ? [{ metric: key, baseline: baseline.metrics[key], actual, allowed: Math.round(allowed * 10) / 10 }] : [];
      });
      console.log(JSON.stringify({ performanceBaseline: baselinePath, metrics, regressions }));
      if (regressions.length > 0) process.exitCode = 1;
    } catch (error) {
      console.error(`性能基準がありません。初回は --update-baseline を付けて実行してください: ${baselinePath}`);
      process.exitCode = 1;
    }
  }
}
