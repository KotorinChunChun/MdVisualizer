import type { ClipboardImagePngLocation } from "../types/settings";
import type { StagedDocumentAsset } from "../types/app";
import { collectImageOccurrences } from "./imageOccurrences";

export interface ClipboardImageData {
  mediaType: string;
  base64: string;
}

export interface ResolvedClipboardImage {
  source: string;
  asset?: StagedDocumentAsset;
}

export function clipboardImageFile(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) return null;
  const itemFiles = Array.from(dataTransfer.items).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file?.type.toLowerCase().startsWith("image/") ? [file] : [];
  });
  const files = itemFiles.length > 0
    ? itemFiles
    : Array.from(dataTransfer.files).filter((file) => file.type.toLowerCase().startsWith("image/"));
  const priority = (file: File) => file.type.toLowerCase() === "image/png" ? 0 : file.type.toLowerCase() === "image/svg+xml" ? 2 : 1;
  return files.sort((left, right) => priority(left) - priority(right))[0] ?? null;
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

export function referencedStagedAssetIds(content: string, baseDir: string, assets: StagedDocumentAsset[]): string[] {
  const sources = new Set(collectImageOccurrences(content, baseDir).map((occurrence) => occurrence.source));
  return assets.filter((asset) => sources.has(asset.filename)).map((asset) => asset.id);
}
