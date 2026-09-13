import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import hljs from 'highlight.js';
import { normalizeStructuredListIndentationForRendering, isPlantUmlFenceLanguage, plantUmlToMermaid } from '../../packages/markdown-core/src/index';
import { remarkObsidianImages } from '../../src/lib/remarkObsidianImages';
import { markdownSanitizeSchema } from '../../src/lib/sanitizeSchema';
import { nextHeadingId } from '../../src/lib/headingIds';
import { renderMermaid } from '../../src/lib/mermaidService';
import { isDelimitedTableLanguage, parseDelimitedTable } from '../../src/lib/delimitedTable';
import { calculateTableAggregates, isTableAggregateResultCell } from '../../src/lib/tableAggregation';
import { splitFenceLanguagePath } from '../../src/lib/externalPathRepresentation';
import appCss from '../../src/styles/app.css?raw';
import themesCss from '../../src/styles/themes.css?raw';
import syntaxCss from '../../src/styles/syntax-highlight.css?raw';

type Asset = { base: string; mime: string; text?: string; data: string };
type Task = { id: string; kind: string; source: string; alt: string; base?: string };
declare global {
  interface Window {
    __readAsset: (source: string, base?: string) => Promise<Asset>;
    __drawioViewer: () => Promise<string>;
    __htmlExport: { prepare: typeof prepare; finish: typeof finish; replaceRaster: typeof replaceRaster };
    GraphViewer?: { processElements: () => void };
  }
}

const baseCss = `*{box-sizing:border-box}body{margin:0;padding:24px;font-family:system-ui,sans-serif;line-height:1.65}
.markdown-body{max-width:1100px;margin:0 auto;overflow-wrap:anywhere}.markdown-body img{max-width:100%;height:auto}
figure{margin:1em 0}figcaption{font-size:.9em}pre{padding:16px;overflow:auto}code{font-family:Consolas,monospace}
.table-scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse}td,th{border:1px solid;padding:6px 12px}
blockquote{margin:1em 0;padding-left:1em;border-left:4px solid}h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1em 0 .5em}
p,ul,ol{margin:.7em 0}ul,ol{padding-left:2em}hr{border:0;border-top:1px solid}
@media(max-width:600px){body{padding:12px}}`;
const svgTags = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs use linearGradient radialGradient stop clipPath mask pattern title desc marker image foreignObject switch symbol filter feGaussianBlur feOffset feFlood feComposite feMerge feMergeNode feColorMatrix feBlend'.toLowerCase().split(' '));
const htmlTags = new Set('div span p b strong i em u s br sub sup ul ol li table tbody thead tr td th code pre'.split(' '));
const styleProperties = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'white-space', 'vertical-align', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom', 'list-style-type'];
let title = '', theme = 'dark';
let host: HTMLElement;
let tasks: Task[] = [];
let svgCounter = 0;
let drawioLoaded = false;

function escape(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }
function placeholder(kind: string, source: string, alt: string) {
  const id = `export-item-${tasks.length}`;
  tasks.push({ id, kind, source, alt });
  return <span data-export-item={id} />;
}
function trustedCss(css: string) {
  // 外部参照・難読化・HTML終端を許可しない。本文の静的スタイルだけを受け取る。
  if (/[\\<>]|@import|@font-face|@namespace|url\s*\(|image-set\s*\(|expression\s*\(/i.test(css)) throw new Error('追加CSSに外部参照または非対応の構文があります。');
  return css.replace(/:scope\b/g, '.markdown-body');
}
function previewCss() {
  const sheet = new CSSStyleSheet(); sheet.replaceSync(`${appCss}\n${themesCss}\n${syntaxCss}`);
  const selected: string[] = [];
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSStyleRule)) continue;
    const selectors = rule.selectorText.split(',').map(s => s.trim()).filter(s => s.startsWith(':root') || s.includes('.markdown-body') || s.includes('.hljs'));
    if (selectors.length) selected.push(`${selectors.join(',')}{${rule.style.cssText}}`);
  }
  return selected.join('\n');
}

function codeHtml(source: string, language: string) {
  return hljs.getLanguage(language) ? hljs.highlight(source, { language }).value : escape(source);
}
function tableElement(source: string, language: string) {
  const parsed = parseDelimitedTable(source, language as Parameters<typeof parseDelimitedTable>[1]);
  const result = calculateTableAggregates(parsed);
  const wrapper = document.createElement('div'); wrapper.className = 'table-scroll';
  wrapper.innerHTML = `<table><thead><tr>${result.headers.map(value => `<th>${escape(value)}</th>`).join('')}</tr></thead><tbody>${result.rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return wrapper;
}

async function imageElement(data: string, alt: string) {
  const image = new Image(); image.alt = alt; image.src = data;
  await image.decode().catch(() => { throw new Error('画像を復号できません。'); });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('画像の寸法が不正です。');
  return image;
}

async function sanitizeSvg(source: string, base?: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVGのDTD・外部実体は使用できません。');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName !== 'svg') throw new Error('SVGを解析できません。');
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!element.isConnected) continue;
    const tag = element.localName.toLowerCase();
    if (tag === 'style') {
      const css = element.textContent ?? '';
      // 生成SVGの内部CSSは保持する。外部読込は別途埋め込まれたimageに限定する。
      if (/[\\<]|@import|@font-face|@namespace|expression\s*\(|image-set\s*\(/i.test(css) || /url\(\s*['"]?(?!#)/i.test(css)) throw new Error('SVG内CSSの外部参照を自己完結できません。');
      continue;
    }
    const inHtml = Boolean(element.closest('foreignObject')) && tag !== 'foreignobject';
    if (!(inHtml ? htmlTags : svgTags).has(tag)) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      if (name.startsWith('on') || ['content', 'data-mxgraph', 'contenteditable', 'tabindex'].includes(name) || /^data-/.test(name)) element.removeAttribute(attribute.name);
      else if (name === 'href' || name === 'xlink:href' || name === 'src') {
        if (value.startsWith('#')) continue;
        if (tag === 'image') {
          const asset = await window.__readAsset(value, base);
          if (!asset.mime?.startsWith('image/') || asset.mime === 'image/svg+xml') throw new Error('SVG内の画像はPNG/JPEG等のラスター形式で指定してください。');
          await imageElement(asset.data, ''); element.setAttribute(attribute.name, asset.data);
        } else element.removeAttribute(attribute.name);
      } else if (name === 'style') {
        if (/[\\]|@|expression\s*\(|image-set\s*\(/i.test(value) || /url\(\s*['"]?(?!#)/i.test(value)) throw new Error('SVGのstyleに非対応の参照があります。');
      } else if (/url\(/i.test(value) && !/^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/i.test(value)) throw new Error('SVGに外部参照があります。');
    }
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // 図間のID重複を防ぎ、CSSと内部参照も同じ接頭辞へ変更する。
  const prefix = `export-svg-${svgCounter++}-`;
  const ids = [...root.querySelectorAll('[id]')].map(e => e.id);
  if (root.id) ids.push(root.id);
  let serialized = new XMLSerializer().serializeToString(root);
  for (const id of ids.sort((a, b) => b.length - a.length)) {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    serialized = serialized.replace(new RegExp(`([#])${escapedId}(?![\\w-])`, 'g'), `$1${prefix}${id}`).replace(new RegExp(`id="${escapedId}"`, 'g'), `id="${prefix}${id}"`);
  }
  const parsed = new DOMParser().parseFromString(serialized, 'image/svg+xml');
  return document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
}

async function svgElement(source: string, alt: string, base?: string): Promise<HTMLElement> {
  const svg = await sanitizeSvg(source, base);
  const wrapper = document.createElement('figure');
  wrapper.setAttribute('aria-label', alt || '図'); wrapper.append(svg);
  host.append(wrapper);
  svg.style.maxWidth = '100%'; svg.style.height = 'auto';
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) { svg.setAttribute('width', String(viewBox.width)); svg.setAttribute('height', String(viewBox.height)); }
  if (svg.querySelector('foreignObject')) {
    wrapper.dataset.exportRaster = 'true';
    // 実DOMを図単位で取得するためHTMLラベルとフォントの外観を保てる。
    return wrapper;
  }
  const serialized = new XMLSerializer().serializeToString(svg);
  const data = `data:image/svg+xml;base64,${btoa(Array.from(new TextEncoder().encode(serialized), b => String.fromCharCode(b)).join(''))}`;
  wrapper.replaceChildren(await imageElement(data, alt || '図'));
  return wrapper;
}

async function drawio(source: string, base?: string) {
  if (/^\s*<svg[\s>]/i.test(source)) return [source];
  if (/^\s*(?:graph|flowchart|sequenceDiagram)\b/.test(source)) return [await renderMermaid(source, `export-drawio-${svgCounter++}`, theme)];
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('draw.ioの外部実体は使用できません。');
  let xml = source.trim();
  async function inflate(text: string) {
    const binary = Uint8Array.from(atob(text), char => char.charCodeAt(0));
    const stream = new Blob([binary]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader(); let length = 0; const chunks: Uint8Array[] = [];
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('draw.io展開容量を超えました。'); } chunks.push(part.value); }
    return decodeURIComponent(await new Blob(chunks as BlobPart[]).text());
  }
  if (!xml.startsWith('<')) xml = await inflate(xml);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('draw.io XMLが不正です。');
  for (const diagram of doc.querySelectorAll('diagram')) {
    if (!diagram.querySelector('mxGraphModel') && diagram.textContent?.trim()) {
      const inner = new DOMParser().parseFromString(await inflate(diagram.textContent.trim()), 'application/xml');
      if (inner.querySelector('parsererror')) throw new Error('draw.io圧縮データが不正です。');
      diagram.replaceChildren(doc.importNode(inner.documentElement, true));
    }
  }
  const models = [...doc.querySelectorAll('mxGraphModel')];
  if (!models.length) throw new Error('draw.ioの図データがありません。');
  if (!drawioLoaded) {
    const code = await window.__drawioViewer();
    const script = document.createElement('script'); script.textContent = code; document.head.append(script);
    if (!window.GraphViewer) throw new Error('draw.ioビューアーを初期化できません。');
    drawioLoaded = true;
  }
  const results: string[] = [];
  for (const model of models) {
    for (const cell of model.querySelectorAll('*')) {
      if (!['mxGraphModel', 'root', 'mxCell', 'mxGeometry', 'mxPoint', 'Array', 'Object', 'object', 'UserObject', 'mxRectangle'].includes(cell.localName)) throw new Error('draw.ioに非対応の要素があります。');
      for (const attr of [...cell.attributes]) {
        if (/^on|^(?:link|href|src)$/i.test(attr.name)) cell.removeAttribute(attr.name);
        if (attr.name === 'value' || attr.name === 'label') {
          const label = new DOMParser().parseFromString(attr.value, 'text/html');
          for (const el of [...label.body.querySelectorAll('*')]) {
            if (!htmlTags.has(el.localName)) { el.replaceWith(document.createTextNode(el.textContent ?? '')); continue; }
            for (const a of [...el.attributes]) if (a.name !== 'style') el.removeAttribute(a.name); else if (/[\\@]|url\s*\(|expression|image-set/i.test(a.value)) el.removeAttribute('style');
          }
          cell.setAttribute(attr.name, label.body.innerHTML);
        }
      }
      const style = cell.getAttribute('style');
      if (style) {
        let next = style;
        for (const match of style.matchAll(/(?:^|;)image=([^;]+)(?=;|$)/g)) {
          const asset = await window.__readAsset(match[1], base);
          if (!asset.mime?.startsWith('image/') || asset.mime === 'image/svg+xml') throw new Error('draw.io内画像の形式が非対応です。');
          next = next.replace(`image=${match[1]}`, `image=${asset.data}`);
        }
        cell.setAttribute('style', next);
      }
    }
    const viewer = document.createElement('div'); viewer.className = 'mxgraph';
    viewer.style.width = '1052px';
    viewer.dataset.mxgraph = JSON.stringify({ xml: new XMLSerializer().serializeToString(model), nav: false, toolbar: '', lightbox: false, resize: true, border: 10 });
    host.append(viewer); window.GraphViewer!.processElements();
    const start = Date.now();
    while (!viewer.querySelector('svg')) { if (Date.now() - start > 20_000) throw new Error('draw.ioの描画がタイムアウトしました。'); await new Promise(resolve => setTimeout(resolve, 30)); }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const svg = viewer.querySelector('svg')!;
    if (!svg.getAttribute('viewBox')) {
      const bounds = svg.getBBox();
      svg.setAttribute('viewBox', `${bounds.x - 10} ${bounds.y - 10} ${Math.max(1, bounds.width + 20)} ${Math.max(1, bounds.height + 20)}`);
    }
    results.push(svg.outerHTML); viewer.remove();
  }
  return results;
}

async function renderTask(task: Task): Promise<Node> {
  let { kind, source, alt, base } = task;
  if (kind === 'asset') {
    const asset = await window.__readAsset(source, base);
    const extension = source.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
    base = asset.base;
    if (asset.mime === 'image/svg+xml') return svgElement(asset.text!, alt, base);
    if (asset.mime?.startsWith('image/')) return imageElement(asset.data, alt);
    if (asset.text === undefined) throw new Error('資産形式が非対応です。');
    source = asset.text;
    kind = ({ mmd: 'mermaid', mermaid: 'mermaid', drawio: 'drawio', csv: 'csv', tsv: 'tsv' } as Record<string, string>)[extension] ?? extension;
  }
  if (isDelimitedTableLanguage(kind)) return tableElement(source, kind);
  if (kind === 'svg') return svgElement(source, alt, base);
  if (isPlantUmlFenceLanguage(kind)) { source = plantUmlToMermaid(source).mermaid; kind = 'mermaid'; }
  if (kind === 'mermaid') return svgElement(await renderMermaid(source, `export-mermaid-${svgCounter++}`, theme), alt || 'Mermaid図', base);
  if (kind === 'drawio') {
    const group = document.createElement('div');
    for (const svg of await drawio(source, base)) group.append(await svgElement(svg, alt || 'draw.io図', base));
    return group;
  }
  const pre = document.createElement('pre'); pre.innerHTML = `<code class="hljs">${codeHtml(source, kind)}</code>`; return pre;
}

async function prepare(options: { markdown: string; title: string; theme: string; css: string }) {
  ({ title, theme } = options); tasks = []; svgCounter = 0;
  document.documentElement.dataset.theme = theme;
  const style = document.createElement('style'); style.textContent = `${baseCss}\n${previewCss()}\n${trustedCss(options.css)}`; document.head.append(style);
  host = document.createElement('main'); host.className = 'markdown-body'; document.body.append(host);
  document.body.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-color');
  document.body.style.color = getComputedStyle(document.documentElement).getPropertyValue('--text-primary');
  const markdown = normalizeStructuredListIndentationForRendering(options.markdown);
  host.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkObsidianImages]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
    urlTransform={url => url}
    components={{
      code: ({ className, children }) => {
        const raw = className?.match(/language-(\S+)/)?.[1];
        if (!raw) return <code>{children}</code>;
        const language = splitFenceLanguagePath(raw).language;
        return placeholder(language, String(children).replace(/\n$/, ''), '');
      },
      img: ({ src, alt, width, height }) => <span data-image-width={width} data-image-height={height}>{placeholder('asset', String(src ?? ''), alt ?? '')}</span>,
      a: ({ href, children }) => href && (/^#[^\s]*$/.test(href) || /^https?:\/\//i.test(href)) ? <a href={href} rel="noreferrer">{children}</a> : <span>{children}</span>,
      input: ({ checked }) => <span aria-label={checked ? 'チェック済み' : '未チェック'}>{checked ? '☑' : '☐'}</span>,
    }}>{markdown}</ReactMarkdown>);
  const headings = new Map<string, number>();
  for (const heading of host.querySelectorAll('h1,h2,h3,h4,h5,h6')) heading.id = nextHeadingId(headings, heading.textContent ?? '');
  const rawSvgs = [...host.querySelectorAll('svg')];
  for (const svg of rawSvgs) svg.replaceWith(await svgElement(svg.outerHTML, svg.getAttribute('aria-label') ?? 'SVG図'));
  const diagrams = tasks.filter(task => ['svg', 'mermaid', 'drawio', 'plantuml', 'puml'].includes(task.kind)).length;
  if (diagrams > 200) throw new Error('文書内の図が200件を超えています。');
  for (const task of tasks) {
    const marker = host.querySelector(`[data-export-item="${task.id}"]`)!;
    let result: Node;
    try { result = await renderTask(task); } catch (error) { throw new Error(`項目${Number(task.id.split('-').pop()) + 1}: ${(error as Error).message}`); }
    const sized = marker.parentElement;
    if (sized?.hasAttribute('data-image-width') && result instanceof HTMLElement) {
      const width = Number(sized.getAttribute('data-image-width'));
      if (Number.isFinite(width) && width > 0) result.style.width = `${Math.min(width, 8192)}px`;
    }
    const replace = marker.parentElement?.tagName === 'PRE' ? marker.parentElement : marker;
    replace.replaceWith(result);
  }
  // Markdown表の集計値もアプリと同じ計算器で確定する。
  for (const table of host.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent ?? '');
    const rows = [...table.querySelectorAll('tbody tr')].map(row => [...row.children].map(cell => cell.textContent ?? ''));
    const result = calculateTableAggregates({ headers, rows });
    for (const [r, row] of [...table.querySelectorAll('tbody tr')].entries()) for (const [c, cell] of [...row.children].entries()) if (isTableAggregateResultCell(result, r, c)) cell.textContent = result.rows[r][c];
    if (!table.parentElement?.classList.contains('table-scroll')) { const wrapper = document.createElement('div'); wrapper.className = 'table-scroll'; table.replaceWith(wrapper); wrapper.append(table); }
  }
  for (const details of host.querySelectorAll('details')) details.setAttribute('open', '');
  await document.fonts.ready;
  await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
  return { items: tasks.length, diagrams, tables: host.querySelectorAll('table').length };
}

function replaceRaster(element: Element, data: string) {
  const img = new Image(); img.src = data; img.alt = element.getAttribute('aria-label') ?? '図';
  const width = element.getBoundingClientRect().width; img.style.width = `${width}px`;
  element.replaceWith(img);
}

function finish() {
  if (host.querySelector('[data-export-item],[data-export-raster]')) throw new Error('出力の準備が完了していません。');
  for (const element of host.querySelectorAll('script,iframe,object,embed,link,style,form,button,input,textarea,select')) element.remove();
  for (const detail of host.querySelectorAll('details,summary')) { const replacement = document.createElement('div'); replacement.append(...detail.childNodes); detail.replaceWith(replacement); }
  for (const element of [host, ...host.querySelectorAll<HTMLElement>('*')]) {
    const computed = getComputedStyle(element);
    if (computed.display === 'none' || computed.visibility === 'hidden') throw new Error('本文CSSで内容が非表示になっています。');
    for (const property of styleProperties) element.style.setProperty(property, computed.getPropertyValue(property));
    for (const attr of [...element.attributes]) {
      if (attr.name.startsWith('on') || attr.name.startsWith('data-') || ['contenteditable', 'tabindex', 'srcset', 'autofocus'].includes(attr.name)) element.removeAttribute(attr.name);
      if (['src', 'href', 'poster', 'background'].includes(attr.name)) {
        const valid = attr.name === 'src' && element.tagName === 'IMG' && /^data:image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon|svg\+xml);base64,/i.test(attr.value)
          || attr.name === 'href' && element.tagName === 'A' && /^(?:#|https?:\/\/)/i.test(attr.value);
        if (!valid) throw new Error('出力HTMLに未解決の参照が残っています。');
      }
    }
    if (/url\s*\(|expression|[\\<>]/i.test(element.style.cssText)) throw new Error('出力HTMLのスタイルを自己完結できません。');
  }
  const bodyStyle = `background-color:${document.body.style.backgroundColor};color:${document.body.style.color}`;
  return `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${baseCss}</style></head><body style="${bodyStyle}">${host.outerHTML}</body></html>\n`;
}
window.__htmlExport = { prepare, finish, replaceRaster };
