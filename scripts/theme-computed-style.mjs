import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.argv[2] ?? 9222);
const outputDirectory = process.argv[3] ?? "C:/tmp/markdownviewer-theme";
await mkdir(outputDirectory, { recursive: true });

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
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

await command("Page.enable");
await command("Runtime.enable");
await command("Runtime.evaluate", {
  awaitPromise: true,
  expression: `new Promise((resolve) => {
    const select = document.querySelector("select[aria-label='レイアウト']");
    if (select) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, "standard");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setTimeout(resolve, 250);
  })`,
});
const themes = ["dark", "light", "github", "solarized", "nord"];
const results = [];
for (const theme of themes) {
  const evaluated = await command("Runtime.evaluate", {
    returnByValue: true,
    awaitPromise: true,
    expression: `new Promise((resolve) => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const inline = document.querySelector(".markdown-body p code");
        const header = document.querySelector(".markdown-body th");
        const link = document.querySelector(".markdown-body a");
        const style = (element) => element ? {
          color: getComputedStyle(element).color,
          backgroundColor: getComputedStyle(element).backgroundColor,
        } : null;
        resolve({
          theme: ${JSON.stringify(theme)},
          body: {
            color: getComputedStyle(document.documentElement).getPropertyValue("--text-primary").trim(),
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg-color").trim(),
          },
          inline: style(inline),
          header: style(header),
          link: style(link),
        });
      }));
    })`,
  });
  const value = evaluated.result.value;
  if (!value.inline || !value.header || !value.link) throw new Error(`theme probe elements missing for ${theme}`);
  results.push(value);
  await command("Runtime.evaluate", { expression: `document.querySelector(".markdown-body p code")?.scrollIntoView({ block: "center" })` });
  const inlineScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(`${outputDirectory}/${theme}-inline.png`, Buffer.from(inlineScreenshot.data, "base64"));
  await command("Runtime.evaluate", { expression: `document.querySelector(".markdown-body th")?.scrollIntoView({ block: "center" })` });
  const tableScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(`${outputDirectory}/${theme}-table.png`, Buffer.from(tableScreenshot.data, "base64"));
}

const parseRgb = (value) => {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((character) => character.repeat(2)).join("") : hex;
    return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
  }
  return (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
};
const luminance = (value) => {
  const channels = parseRgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (foreground, background) => {
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (bright + 0.05) / (dark + 0.05);
};
for (const result of results) {
  result.contrast = {
    inline: contrast(result.inline.color, result.inline.backgroundColor),
    header: contrast(result.header.color, result.header.backgroundColor),
    link: contrast(result.link.color, result.body.backgroundColor),
  };
  for (const [kind, ratio] of Object.entries(result.contrast)) {
    if (ratio < 4.5) throw new Error(`${result.theme} ${kind} contrast ${ratio.toFixed(2)} is below 4.5`);
  }
}
await writeFile(`${outputDirectory}/computed-styles.json`, JSON.stringify(results, null, 2), "utf8");
socket.close();
console.log(JSON.stringify({ outputDirectory, results }));
