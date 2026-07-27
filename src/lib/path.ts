import { convertFileSrc } from "@tauri-apps/api/core";

export function resolveImageSrc(src: string, baseDir: string): string {
  if (!src) return "";
  const lower = src.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:")) {
    return src;
  }

  let fullPath = src;
  if (!src.startsWith("/") && !src.includes(":\\")) {
    // 相対パスの場合
    const normalizedBase = baseDir.replace(/\\/g, "/").replace(/\/$/, "");
    const normalizedSrc = src.replace(/\\/g, "/").replace(/^\.\//, "");
    fullPath = `${normalizedBase}/${normalizedSrc}`;
  }

  try {
    return convertFileSrc(fullPath);
  } catch {
    return fullPath;
  }
}

export function getFileName(pathStr: string): string {
  if (!pathStr) return "";
  const normalized = pathStr.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || pathStr;
}
