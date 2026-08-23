import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const port = Number(process.argv[2] ?? 9333);
const outputDirectory = process.argv[3];
const samplesDirectory = process.argv[4];
const base64Fixture = process.argv[5];
const pngFixture = process.argv[6];
if (!outputDirectory || !samplesDirectory || !base64Fixture || !pngFixture) throw new Error("Sample suite arguments are incomplete.");
await mkdir(outputDirectory, { recursive: true });
const clipboardPngBase64 = (await readFile(join(samplesDirectory, "images", "sample.png"))).toString("base64");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizePath = (value) => value.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
const safeName = (value) => value.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-|-$/g, "");

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
const runtimeExceptions = [];
const consoleErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    runtimeExceptions.push(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? "Unknown runtime exception");
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
    consoleErrors.push((message.params.args ?? []).map((argument) => argument.value ?? argument.description ?? "").join(" "));
  }
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
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Runtime evaluation failed");
  return response.result.value;
};
const screenshot = async (filename) => {
  const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = join(outputDirectory, filename);
  await writeFile(path, Buffer.from(capture.data, "base64"));
  return path;
};
const setSelect = (label, value) => evaluate(`(() => {
  const select = document.querySelector(${JSON.stringify(`select[aria-label='${label}']`)});
  if (!select) throw new Error(${JSON.stringify(`${label} がありません。`)});
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
const clickSettingsSave = async () => {
  await evaluate(`(() => {
    document.querySelector('.toast .btn-close')?.click();
    const button = document.querySelector('.settings-save');
    if (!button) throw new Error('設定の保存ボタンがありません。');
    button.click();
  })()`);
  const saved = await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      const button = document.querySelector('.settings-save');
      const error = document.querySelector('.settings-error')?.textContent ?? '';
      const toast = document.querySelector('.toast-message')?.textContent?.trim() ?? '';
      if (error) resolve({ ok: false, error });
      else if (toast.startsWith('設定の保存に失敗しました')) resolve({ ok: false, error: toast });
      else if (toast === '設定を保存しました' && button && !button.disabled) resolve({ ok: true });
      else if (Date.now() >= deadline) resolve({ ok: false, error: '設定保存が15秒以内に完了しませんでした。' });
      else setTimeout(poll, 50);
    };
    poll();
  })`);
  if (!saved.ok) throw new Error(saved.error);
};
const activateTab = async (path) => {
  const normalized = normalizePath(path);
  const activated = await evaluate(`new Promise((resolve) => {
    const normalize = (value) => value.replace(/\\\\/g, '/').toLowerCase();
    const tab = [...document.querySelectorAll('.tab[title]')].find((candidate) => normalize(candidate.title).endsWith(${JSON.stringify(normalized)}));
    if (!tab) { resolve(false); return; }
    tab.click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
  if (!activated) throw new Error(`Tab was not found: ${path}`);
};
const activateSettings = async () => {
  await evaluate(`document.querySelector("button[aria-label='設定を開く']")?.click()`);
  const ready = await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 5000;
    const poll = () => {
      if (document.querySelector('.settings-panel')) resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 50);
    };
    poll();
  })`);
  if (!ready) throw new Error("Settings panel did not open.");
};
const switchEditorMode = async (label) => {
  const switched = await evaluate(`new Promise((resolve) => {
    const button = [...document.querySelectorAll('.editor-mode-segments button')].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)});
    if (!button) { resolve(false); return; }
    button.click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
  if (!switched) throw new Error(`Editor mode button was not found: ${label}`);
};
const pasteTinyPng = async () => {
  const dispatched = await evaluate(`(() => {
    const editor = document.querySelector('.markdown-editor .cm-content');
    if (!editor) return false;
    editor.focus();
    const bytes = Uint8Array.from(atob(${JSON.stringify(clipboardPngBase64)}), (character) => character.charCodeAt(0));
    const file = new File([bytes], 'clipboard.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    return editor.dispatchEvent(event);
  })()`);
  if (dispatched !== false) throw new Error("Image paste was not intercepted by the editor.");
};
const waitForEditorText = async (pattern) => {
  const result = await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      const text = document.querySelector('.markdown-editor .cm-content')?.textContent ?? '';
      const toastError = document.querySelector('.toast-error .toast-message')?.textContent ?? '';
      if (${pattern}.test(text)) resolve({ ok: true, text });
      else if (toastError) resolve({ ok: false, error: toastError, text });
      else if (document.querySelector('[role=alert]')) resolve({ ok: false, error: document.querySelector('[role=alert]').textContent });
      else if (Date.now() >= deadline) resolve({ ok: false, error: '貼り付け結果が15秒以内に現れませんでした。', text });
      else setTimeout(poll, 50);
    };
    poll();
  })`);
  if (!result.ok) throw new Error(result.error);
  return result.text;
};

await command("Page.enable");
await command("Runtime.enable");

const directoryEntries = await readdir(samplesDirectory, { recursive: true, withFileTypes: true });
const expectedSamples = directoryEntries
  .filter((entry) => entry.isFile() && [".md", ".markdown", ".svg", ".mmd", ".mermaid"].includes(extname(entry.name).toLowerCase()))
  .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
  .sort((left, right) => left.localeCompare(right));
const availableTabs = await evaluate(`[...document.querySelectorAll('.tab[title]')].map((tab) => tab.title)`);
const availableIdentities = new Set(availableTabs.map(normalizePath));
const missingTabs = expectedSamples.filter((path) => !availableIdentities.has(normalizePath(path)));
if (missingTabs.length > 0) throw new Error(`Sample tabs are missing: ${missingTabs.join(", ")}`);

const sampleResults = [];
for (const path of expectedSamples) {
  await activateTab(path);
  if ([".md", ".markdown"].includes(extname(path).toLowerCase())) await switchEditorMode("閲覧のみ");
  // 永続化済みの折りたたみ・レイアウト設定は変更せず、検証中のDOMだけ展開する。
  // プレゼン表示では印刷用の全ページDOMを一時表示し、現在ページ以外も検証する。
  const mermaidCount = await evaluate(`(() => {
    const preview = document.querySelector('.preview-container');
    const presentation = preview?.querySelector('.presentation-view');
    const printPages = presentation?.querySelector('.presentation-print-pages');
    if (presentation && printPages) {
      preview.style.overflow = 'auto';
      presentation.style.display = 'block';
      presentation.style.height = 'auto';
      printPages.style.display = 'block';
    }
    preview?.querySelectorAll('.fold-content[hidden]').forEach((content) => { content.hidden = false; });
    return preview?.querySelectorAll('.mermaid-container').length ?? 0;
  })()`);
  for (let index = 0; index < mermaidCount; index += 1) {
    const settled = await evaluate(`new Promise((resolve) => {
      const preview = document.querySelector('.preview-container');
      let block = preview?.querySelectorAll('.mermaid-container')[${index}];
      block?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const scroller = preview;
      if (block && scroller) {
        const blockRect = block.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        scroller.scrollTop += blockRect.top - scrollerRect.top - Math.max(0, (scroller.clientHeight - blockRect.height) / 2);
        scroller.dispatchEvent(new Event('scroll'));
      }
      const deadline = Date.now() + 30000;
      const poll = () => {
        block = preview?.querySelectorAll('.mermaid-container')[${index}];
        if (!block || block.querySelector('svg, .mermaid-error, .mermaid-source')) resolve(true);
        else if (Date.now() >= deadline) resolve(false);
        else setTimeout(poll, 100);
      };
      poll();
    })`);
    if (!settled) {
      const details = await evaluate(`(() => {
        const scroller = document.querySelector('.preview-container');
        const block = scroller?.querySelectorAll('.mermaid-container')[${index}];
        return { html: block?.innerHTML, rect: block?.getBoundingClientRect().toJSON(), scrollTop: scroller?.scrollTop, viewportHeight: scroller?.clientHeight };
      })()`);
      await screenshot(`failed-mermaid-${safeName(relative(samplesDirectory, path))}-${index + 1}.png`);
      throw new Error(`Mermaid block ${index + 1} did not settle (${path}): ${JSON.stringify(details)}`);
    }
  }
  const drawioCount = await evaluate(`document.querySelector('.preview-container')?.querySelectorAll('.drawio-block').length ?? 0`);
  for (let index = 0; index < drawioCount; index += 1) {
    const settled = await evaluate(`new Promise((resolve) => {
      const preview = document.querySelector('.preview-container');
      let block = preview?.querySelectorAll('.drawio-block')[${index}];
      block?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const deadline = Date.now() + 30000;
      const poll = () => {
        block = preview?.querySelectorAll('.drawio-block')[${index}];
        if (!block || block.querySelector('.drawio-block__zoom, .drawio-block__error, .drawio-block__fallback, .mermaid-error')) resolve(true);
        else if (Date.now() >= deadline) resolve(false);
        else setTimeout(poll, 100);
      };
      poll();
    })`);
    if (!settled) throw new Error(`draw.io block ${index + 1} did not settle: ${path}`);
  }
  const rendered = await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      const preview = document.querySelector('.preview-container');
      const body = preview?.querySelector('.markdown-body');
      const pendingImages = [...(preview?.querySelectorAll('.markdown-body img') ?? [])].some((image) => !image.complete);
      if (body && !pendingImages) resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 100);
    };
    poll();
  })`);
  if (!rendered) throw new Error(`Sample did not finish rendering: ${path}`);
  const result = await evaluate(`(() => {
    const preview = document.querySelector('.preview-container');
    const body = preview?.querySelector('.markdown-body');
    const images = [...(preview?.querySelectorAll('.markdown-body img') ?? [])];
    return {
      body: Boolean(body),
      textLength: preview?.textContent?.trim().length ?? 0,
      headings: preview?.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6').length ?? 0,
      images: images.length,
      brokenImages: images.filter((image) => image.complete && image.naturalWidth === 0).length,
      inlineSvg: preview?.querySelectorAll('.markdown-body svg').length ?? 0,
      mermaid: preview?.querySelectorAll('.mermaid-container').length ?? 0,
      mermaidErrors: preview?.querySelectorAll('.mermaid-error').length ?? 0,
      drawio: preview?.querySelectorAll('.drawio-block').length ?? 0,
      drawioErrors: preview?.querySelectorAll('.drawio-block__error').length ?? 0,
      drawioFallbacks: preview?.querySelectorAll('.drawio-block__fallback').length ?? 0,
      imageErrors: preview?.querySelectorAll('.image-error-fallback').length ?? 0,
      dataGridErrors: preview?.querySelectorAll('.data-grid-error').length ?? 0,
      emptyError: document.querySelector('.empty-state .empty-title')?.textContent ?? '',
    };
  })()`);
  if (!result.body || result.textLength === 0 || result.brokenImages > 0 || result.mermaidErrors > 0
    || result.drawioErrors > 0 || result.imageErrors > 0 || result.dataGridErrors > 0 || result.emptyError) {
    throw new Error(`Sample verification failed (${path}): ${JSON.stringify(result)}`);
  }
  result.path = path;
  result.screenshot = await screenshot(`sample-${String(sampleResults.length + 1).padStart(2, "0")}-${safeName(relative(samplesDirectory, path))}.png`);
  sampleResults.push(result);
  await evaluate(`(() => {
    const preview = document.querySelector('.preview-container');
    if (preview) preview.style.overflow = '';
  })()`);
}

await activateSettings();
const originalSettings = await evaluate(`(() => {
  const storage = document.querySelector("select[aria-label='貼り付け画像の保存形式']");
  if (!storage) throw new Error('貼り付け画像の保存形式がありません。');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  const originalStorage = storage.value;
  setter.call(storage, 'png');
  storage.dispatchEvent(new Event('change', { bubbles: true }));
  const location = document.querySelector("select[aria-label='貼り付け画像のPNG保存先']");
  return {
    storage: originalStorage,
    location: location?.value ?? 'images',
    absoluteDirectory: document.querySelector("input[aria-label='貼り付け画像の絶対保存フォルダー']")?.value ?? '',
  };
})()`);
await setSelect("貼り付け画像の保存形式", "base64");
await clickSettingsSave();

let pasteResults;
try {
  await activateTab(base64Fixture);
  await switchEditorMode("編集のみ");
  await delay(300);
  await pasteTinyPng();
  const base64Text = await waitForEditorText(`/data:image\\/png;base64,/i`);
  const base64Screenshot = await screenshot("clipboard-base64-paste.png");

  await activateSettings();
  await setSelect("貼り付け画像の保存形式", "png");
  await setSelect("貼り付け画像のPNG保存先", "images");
  await clickSettingsSave();

  await activateTab(pngFixture);
  await switchEditorMode("編集のみ");
  await delay(300);
  await pasteTinyPng();
  const pngText = await waitForEditorText(`/images\\/\\d{8}_\\d{6}(?:-\\d+)?\\.png/i`);
  const source = pngText.match(/images\/\d{8}_\d{6}(?:-\d+)?\.png/i)?.[0];
  if (!source) throw new Error(`PNG source was not found in editor text: ${pngText}`);
  const pngScreenshot = await screenshot("clipboard-png-paste.png");
  await evaluate(`document.querySelector('.markdown-editor__save')?.click()`);
  const saveCompleted = await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      const button = document.querySelector('.markdown-editor__save');
      if (button?.disabled && button.textContent.trim() === '保存') resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 50);
    };
    poll();
  })`);
  if (!saveCompleted) throw new Error("PNG fixture Markdown save did not complete.");
  const pngPath = join(pngFixture, "..", source);
  const pngBytes = await readFile(pngPath);
  if (!pngBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new Error(`Saved clipboard asset is not PNG: ${pngPath}`);
  pasteResults = { base64Embedded: /data:image\/png;base64,/i.test(base64Text), base64Screenshot, pngSource: source, pngPath, pngBytes: pngBytes.length, pngScreenshot };
} finally {
  await activateSettings();
  await setSelect("貼り付け画像の保存形式", originalSettings.storage);
  if (originalSettings.storage === "png") {
    await setSelect("貼り付け画像のPNG保存先", originalSettings.location);
    if (originalSettings.location === "absolute") {
      await evaluate(`(() => {
        const input = document.querySelector("input[aria-label='貼り付け画像の絶対保存フォルダー']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(originalSettings.absoluteDirectory)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    }
  }
  await clickSettingsSave();
}

await delay(250);
if (runtimeExceptions.length > 0) throw new Error(`Runtime exceptions occurred: ${runtimeExceptions.join(" | ")}`);
if (consoleErrors.length > 0) throw new Error(`Console errors occurred: ${consoleErrors.join(" | ")}`);
const report = {
  supportedSampleCount: expectedSamples.length,
  sampleResults,
  pasteResults,
  originalClipboardSettings: originalSettings,
  runtimeExceptions,
  consoleErrors,
};
await writeFile(join(outputDirectory, "sample-suite-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
console.log(JSON.stringify(report));
