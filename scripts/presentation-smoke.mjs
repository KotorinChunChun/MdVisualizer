import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.argv[2] ?? 9334);
const outputDirectory = process.argv[3] ?? "C:/develop/MarkdownViewer/tmp/presentation-evidence";
await mkdir(outputDirectory, { recursive: true });
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url.includes("tauri.localhost"));
if (!target) throw new Error("Tauri page target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
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
  const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return response.result.value;
};
const wait = (milliseconds = 150) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const capture = async (name) => {
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(`${outputDirectory}/${name}.png`, Buffer.from(screenshot.data, "base64"));
};

await command("Page.enable");
await command("Runtime.enable");
await evaluate(`(() => {
  const select = document.querySelector("select[aria-label='レイアウト']");
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(select, "presentation");
  select.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
await wait(300);

const firstPage = await evaluate(`({
  page: document.querySelector(".presentation-navigation span")?.textContent,
  breadcrumb: document.querySelector(".presentation-breadcrumbs")?.textContent,
  title: document.querySelector(".presentation-stage h1")?.textContent,
})`);
if (!firstPage.page || !firstPage.breadcrumb) throw new Error("Presentation UI did not render");
await capture("01-first-page");

let imagePage = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  imagePage = await evaluate(`({
    title: document.querySelector(".presentation-stage h1")?.textContent,
    images: document.querySelectorAll(".presentation-stage .markdown-img").length,
    page: document.querySelector(".presentation-navigation span")?.textContent,
  })`);
  if (imagePage.images >= 2) break;
  const moved = await evaluate(`(() => {
    const button = document.querySelector(".presentation-navigation button:last-child");
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!moved) break;
  await wait();
}
if (!imagePage || imagePage.images < 2) throw new Error("Raster/SVG presentation page not found");
await capture("02-image-page");

await evaluate(`document.querySelectorAll(".presentation-stage .markdown-img")[0].click()`);
await wait();
if (!await evaluate(`Boolean(document.querySelector(".presentation-image-modal"))`)) throw new Error("Raster popup did not open");
await evaluate(`document.querySelector(".presentation-image-modal img").dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }))`);
await wait();
const zoom = await evaluate(`document.querySelector(".presentation-image-modal output")?.textContent`);
if (zoom !== "120%") throw new Error(`Unexpected popup zoom: ${zoom}`);
await capture("03-raster-popup");

await evaluate(`document.querySelector(".presentation-image-modal img").click()`);
await wait();
if (!await evaluate(`Boolean(document.querySelector(".crop-overlay"))`)) throw new Error("Local raster did not enter crop editor");
await capture("04-raster-crop");
await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
await wait();

await evaluate(`document.querySelectorAll(".presentation-stage .markdown-img")[1].click()`);
await wait();
await evaluate(`document.querySelector(".presentation-image-modal img").click()`);
await wait();
if (await evaluate(`Boolean(document.querySelector(".crop-overlay"))`)) throw new Error("SVG incorrectly entered crop editor");
if (!await evaluate(`Boolean(document.querySelector(".presentation-image-modal"))`)) throw new Error("SVG popup closed on second click");
await capture("05-svg-popup");
await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
await wait();

await evaluate(`document.querySelector("button[aria-label='設定を開く']").click()`);
await wait();
const settings = await evaluate(`({
  visible: Boolean(document.querySelector(".settings-panel")),
  mainClass: document.querySelector("main")?.className,
  canScroll: document.querySelector(".settings-panel")?.scrollHeight >= document.querySelector(".settings-panel")?.clientHeight,
})`);
if (!settings.visible || !settings.mainClass.includes("view-settings") || settings.mainClass.includes("view-presentation")) {
  throw new Error(`Settings tab layout failed: ${JSON.stringify(settings)}`);
}
await capture("06-settings-tab");

const result = { firstPage, imagePage, zoom, settings };
await writeFile(`${outputDirectory}/presentation-smoke.json`, JSON.stringify(result, null, 2), "utf8");
socket.close();
console.log(JSON.stringify(result));
