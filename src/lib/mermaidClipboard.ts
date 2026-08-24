import { copyMermaidFile } from "./commands";

export type MermaidCopyKind = "code" | "png" | "svg";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_RASTER_DIMENSION = 8192;
const MAX_RASTER_PIXELS = 16_000_000;

function cssProperty(element: Element, name: string): string | undefined {
  const declaration = element.getAttribute("style")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return declaration?.slice(declaration.indexOf(":") + 1).trim() || undefined;
}

function firstPresentationValue(element: Element, name: string): string | undefined {
  for (const candidate of [element, ...Array.from(element.querySelectorAll("*"))]) {
    const value = candidate.getAttribute(name) ?? cssProperty(candidate, name);
    if (value) return value;
  }
  return undefined;
}

function positivePresentationValue(element: Element, name: string): string | undefined {
  const candidates = [element, ...Array.from(element.querySelectorAll("*"))].reverse();
  for (const candidate of candidates) {
    const value = candidate.getAttribute(name) ?? cssProperty(candidate, name);
    if (value && (Number.parseFloat(value) > 0 || !Number.isFinite(Number.parseFloat(value)))) return value;
  }
  return undefined;
}

function cssNumber(element: Element, name: string): number {
  const value = Number.parseFloat(cssProperty(element, name) ?? "");
  return Number.isFinite(value) ? value : 0;
}

function numericAttribute(element: Element, name: string): number {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : 0;
}

function labelLines(element: Element): string[] {
  let text = "";
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.localName.toLowerCase();
    if (tag === "br") {
      text += "\n";
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
    if (["div", "p", "li"].includes(tag) && !text.endsWith("\n")) text += "\n";
  };
  visit(element);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasAncestorClass(element: Element, className: string): boolean {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (current.classList.contains(className)) return true;
  }
  return false;
}

function estimatedTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, character) => width + fontSize * (/^[\x20-\x7e]$/.test(character) ? 0.6 : 1), 0);
}

function replaceForeignObjectWithText(document: Document): void {
  for (const foreignObject of Array.from(document.querySelectorAll("foreignObject"))) {
    const lines = labelLines(foreignObject);
    const replacement = document.createElementNS(SVG_NAMESPACE, "g");
    const text = document.createElementNS(SVG_NAMESPACE, "text");
    const layout = foreignObject.firstElementChild;
    const originX = numericAttribute(foreignObject, "x");
    const originY = numericAttribute(foreignObject, "y");
    const styledWidth = layout ? cssNumber(layout, "width") : 0;
    const styledHeight = layout ? cssNumber(layout, "height") : 0;
    const width = styledWidth || numericAttribute(foreignObject, "width");
    const height = styledHeight || numericAttribute(foreignObject, "height");
    const x = originX + (layout ? cssNumber(layout, "margin-left") + cssNumber(layout, "padding-left") : 0) + width / 2;
    const y = originY + (layout ? cssNumber(layout, "margin-top") + cssNumber(layout, "padding-top") : 0) + height / 2;
    const fontSizeValue = positivePresentationValue(foreignObject, "font-size") ?? "16px";
    const fontSize = Number.parseFloat(fontSizeValue) || 16;
    const lineHeight = fontSize * 1.2;

    // Mermaidの線上ラベルはHTML側の背景色で罫線を隠している。
    // foreignObjectを取り除く場合も同じ描画順をSVG要素で再現する。
    const htmlBackground = firstPresentationValue(foreignObject, "background-color");
    if (htmlBackground || hasAncestorClass(foreignObject, "edgeLabel") || hasAncestorClass(foreignObject, "labelBkg")) {
      const background = document.createElementNS(SVG_NAMESPACE, "rect");
      background.setAttribute("class", "clipboard-label-background");
      const estimatedWidth = width > 1
        ? width
        : Math.max(width, ...lines.map((line) => estimatedTextWidth(line, fontSize))) + 4;
      const estimatedHeight = height > 1 ? height : Math.max(height, lines.length * lineHeight) + 2;
      background.setAttribute("x", String(x - estimatedWidth / 2));
      background.setAttribute("y", String(y - estimatedHeight / 2));
      background.setAttribute("width", String(estimatedWidth));
      background.setAttribute("height", String(estimatedHeight));
      background.setAttribute("fill", htmlBackground && !/^light-dark\(/i.test(htmlBackground) ? htmlBackground : "#ffffff");
      replacement.appendChild(background);
    }

    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y - Math.max(0, lines.length - 1) * lineHeight / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("font-size", fontSizeValue);
    text.setAttribute("font-family", firstPresentationValue(foreignObject, "font-family") ?? "sans-serif");
    text.setAttribute("fill", firstPresentationValue(foreignObject, "color")
      ?? firstPresentationValue(foreignObject, "fill")
      ?? "#333333");

    const fontWeight = firstPresentationValue(foreignObject, "font-weight");
    if (fontWeight) text.setAttribute("font-weight", fontWeight);
    const transform = foreignObject.getAttribute("transform");
    if (transform) replacement.setAttribute("transform", transform);
    if (lines.length <= 1) {
      text.textContent = lines[0] ?? "";
    } else {
      lines.forEach((line, index) => {
        const tspan = document.createElementNS(SVG_NAMESPACE, "tspan");
        tspan.setAttribute("x", String(x));
        if (index > 0) tspan.setAttribute("dy", String(lineHeight));
        tspan.textContent = line;
        text.appendChild(tspan);
      });
    }
    replacement.appendChild(text);
    foreignObject.replaceWith(replacement);
  }
}

function removeRootSizeLimits(root: Element): void {
  const style = root.getAttribute("style");
  if (!style) return;
  const declarations = style
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !/^max-(?:width|height)\s*:/i.test(part));
  if (declarations.length > 0) root.setAttribute("style", `${declarations.join(";")};`);
  else root.removeAttribute("style");
}

function addWhiteCanvas(document: Document): void {
  const root = document.documentElement;
  root.querySelector('[data-canvas-background="true"]')?.remove();
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const [x, y, width, height] = viewBox?.length === 4 && viewBox.every(Number.isFinite)
    ? viewBox
    : [0, 0, numericAttribute(root, "width"), numericAttribute(root, "height")];
  const background = document.createElementNS(SVG_NAMESPACE, "rect");
  background.setAttribute("data-canvas-background", "true");
  background.setAttribute("x", String(x));
  background.setAttribute("y", String(y));
  background.setAttribute("width", String(width || "100%"));
  background.setAttribute("height", String(height || "100%"));
  background.setAttribute("fill", "#ffffff");
  root.insertBefore(background, root.firstChild);
}

function removeUnsafeSvgContent(document: Document): void {
  for (const element of Array.from(document.querySelectorAll("script, iframe, object, embed, link, audio, video"))) {
    element.remove();
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    style.textContent = (style.textContent ?? "")
      .replace(/@import[^;]+;?/gi, "")
      .replace(/url\(\s*(['\"]?)(?!#)[^)]+\)/gi, "none");
  }

  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if ((name === "href" || name === "xlink:href")
        && !value.startsWith("#")
        && !value.startsWith("data:image/")) {
        element.removeAttribute(attribute.name);
      } else if (name === "style"
        && (/javascript:/i.test(value) || /url\(\s*(['\"]?)(?!#)/i.test(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

/**
 * MermaidがHTMLラベルとして生成するforeignObjectを標準SVGテキストへ変換する。
 * Office等、foreignObjectを表示しない貼り付け先でもラベルを残すための処理。
 */
export function normalizeSvgForClipboard(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
    throw new Error("SVGを解析できません");
  }

  replaceForeignObjectWithText(document);
  removeUnsafeSvgContent(document);
  const root = document.documentElement;
  root.setAttribute("xmlns", SVG_NAMESPACE);
  if (!root.getAttribute("viewBox")) {
    const width = Number.parseFloat(root.getAttribute("width") ?? "");
    const height = Number.parseFloat(root.getAttribute("height") ?? "");
    if (width > 0 && height > 0) root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  removeRootSizeLimits(root);
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    root.setAttribute("width", String(viewBox[2]));
    root.setAttribute("height", String(viewBox[3]));
  }
  addWhiteCanvas(document);
  return new XMLSerializer().serializeToString(root);
}

function svgDimensions(svg: string): { width: number; height: number } {
  const element = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const viewBox = element.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: Math.ceil(viewBox[2]), height: Math.ceil(viewBox[3]) };
  }
  return {
    width: Math.max(1, Math.ceil(Number.parseFloat(element.getAttribute("width") ?? "") || 1000)),
    height: Math.max(1, Math.ceil(Number.parseFloat(element.getAttribute("height") ?? "") || 600)),
  };
}

function rasterDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_RASTER_DIMENSION / width,
    MAX_RASTER_DIMENSION / height,
    Math.sqrt(MAX_RASTER_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function svgToPngBlob(svg: string): Promise<Blob> {
  const normalizedSvg = normalizeSvgForClipboard(svg);
  const dimensions = svgDimensions(normalizedSvg);
  const { width, height } = rasterDimensions(dimensions.width, dimensions.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvasを使用できません");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Mermaid図を画像へ変換できません"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizedSvg)}`;
  });
  context.drawImage(image, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNGを生成できません")), "image/png");
  });
}

async function writeBlob(type: string, blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("この環境は画像のコピーに対応していません");
  }
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}

export async function copyMermaid(kind: MermaidCopyKind, source: string, svg: string): Promise<void> {
  if (kind === "code") {
    await navigator.clipboard.writeText(source);
    return;
  }
  if (kind === "png") {
    await writeBlob("image/png", await svgToPngBlob(svg));
    return;
  }
  const normalizedSvg = normalizeSvgForClipboard(svg);
  try {
    await writeBlob("image/svg+xml", new Blob([normalizedSvg], { type: "image/svg+xml" }));
  } catch {
    // WebView clipboard implementations commonly expose SVG as text rather
    // than accepting image/svg+xml. Keep the vector source intact.
    await navigator.clipboard.writeText(normalizedSvg);
  }
}

export async function copyMermaidAsFile(kind: MermaidCopyKind, source: string, svg: string, diagramKind: "mermaid" | "drawio" = "mermaid"): Promise<string> {
  const normalizedSvg = kind === "code" ? svg : normalizeSvgForClipboard(svg);
  const pngBytes = kind === "png"
    ? Array.from(new Uint8Array(await (await svgToPngBlob(svg)).arrayBuffer()))
    : [];
  return await copyMermaidFile({ kind, diagramKind, source, svg: normalizedSvg, pngBytes });
}
