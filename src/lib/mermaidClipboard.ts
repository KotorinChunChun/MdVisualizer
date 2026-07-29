export type MermaidCopyKind = "code" | "png" | "svg";

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

export async function svgToPngBlob(svg: string): Promise<Blob> {
  const { width, height } = svgDimensions(svg);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvasを使用できません");

  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Mermaid図を画像へ変換できません"));
      image.src = url;
    });
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNGを生成できません")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
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
  try {
    await writeBlob("image/svg+xml", new Blob([svg], { type: "image/svg+xml" }));
  } catch {
    // WebView clipboard implementations commonly expose SVG as text rather
    // than accepting image/svg+xml. Keep the vector source intact.
    await navigator.clipboard.writeText(svg);
  }
}
