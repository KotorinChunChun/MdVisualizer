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

function numericAttribute(element: Element, name: string): number {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : 0;
}

function replaceForeignObjectWithText(document: Document): void {
  for (const foreignObject of Array.from(document.querySelectorAll("foreignObject"))) {
    const label = foreignObject.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const text = document.createElementNS(SVG_NAMESPACE, "text");
    const x = numericAttribute(foreignObject, "x") + numericAttribute(foreignObject, "width") / 2;
    const y = numericAttribute(foreignObject, "y") + numericAttribute(foreignObject, "height") / 2;

    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("font-size", firstPresentationValue(foreignObject, "font-size") ?? "16px");
    text.setAttribute("font-family", firstPresentationValue(foreignObject, "font-family") ?? "sans-serif");
    text.setAttribute("fill", firstPresentationValue(foreignObject, "color")
      ?? firstPresentationValue(foreignObject, "fill")
      ?? "#333333");

    const fontWeight = firstPresentationValue(foreignObject, "font-weight");
    if (fontWeight) text.setAttribute("font-weight", fontWeight);
    const transform = foreignObject.getAttribute("transform");
    if (transform) text.setAttribute("transform", transform);
    text.textContent = label;
    foreignObject.replaceWith(text);
  }
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

export async function copyMermaidAsFile(kind: MermaidCopyKind, source: string, svg: string): Promise<string> {
  const normalizedSvg = kind === "code" ? svg : normalizeSvgForClipboard(svg);
  const pngBytes = kind === "png"
    ? Array.from(new Uint8Array(await (await svgToPngBlob(svg)).arrayBuffer()))
    : [];
  return await copyMermaidFile({ kind, source, svg: normalizedSvg, pngBytes });
}
