import type { ClipboardImagePngLocation } from "../types/settings";

export interface ClipboardImageData {
  mediaType: string;
  base64: string;
}

export interface ResolvedClipboardImage {
  source: string;
  asset?: import("../types/app").StagedDocumentAsset;
}

export function clipboardImageFile(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) return null;
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === "file" && item.type.toLowerCase().startsWith("image/")) return item.getAsFile();
  }
  return Array.from(dataTransfer.files).find((file) => file.type.toLowerCase().startsWith("image/")) ?? null;
}

export async function readClipboardImage(file: Blob): Promise<ClipboardImageData> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("クリップボード画像を読み込めませんでした。"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("クリップボード画像を読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match || !match[1].toLowerCase().startsWith("image/")) throw new Error("クリップボード画像の形式に対応していません。");
  return { mediaType: match[1].toLowerCase(), base64: match[2].replace(/\s/g, "") };
}

export function formatClipboardImageFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}

export function clipboardImageMarkdown(source: string): string {
  const destination = /[\s()]/.test(source) && !source.toLowerCase().startsWith("data:") ? `<${source}>` : source;
  return `![クリップボード画像](${destination})`;
}

export function clipboardImageDestination(location: ClipboardImagePngLocation, absoluteDirectory: string) {
  return { destination: location, absoluteDirectory: location === "absolute" ? absoluteDirectory.trim() : undefined };
}
