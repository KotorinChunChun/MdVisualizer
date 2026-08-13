import { convertFileSrc } from "@tauri-apps/api/core";
import { isSupportedDocumentPath } from "./pathIdentity";

/** Windows drive paths are absolute even when written with forward slashes. */
export function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

export function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

export function resolveImageSrc(src: string, baseDir: string): string {
  if (!src) return "";
  const lower = src.toLowerCase();
  // A file URL is already a browser-resolvable viewing source.  It remains
  // display-only in ImageRenderer and must not be sent through convertFileSrc.
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:") || lower.startsWith("file://")) {
    return src;
  }

  let fullPath = src;
  if (!isAbsoluteLocalPath(src)) {
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

/** Resolves a local image reference to a normalized filesystem path. */
export function resolveLocalImagePath(src: string, baseDir: string): string | null {
  if (!src) return null;
  const lower = src.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:")) return null;
  if (lower.startsWith("file://")) {
    try {
      return normalizeLocalPath(decodePath(new URL(src).pathname).replace(/^\/(?=[a-zA-Z]:)/, ""));
    } catch {
      return null;
    }
  }
  const candidate = decodePath(src.split(/[?#]/, 1)[0]);
  return isAbsoluteLocalPath(candidate)
    ? normalizeLocalPath(candidate)
    : normalizeLocalPath(`${baseDir.replace(/[\\/]$/, "")}/${candidate}`);
}

export function getFileName(pathStr: string): string {
  if (!pathStr) return "";
  const normalized = pathStr.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || pathStr;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeLocalPath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    // WebView2's app-local URL can survive URL decoding as /?/C:/...
    .replace(/^\/\?\/(?=[a-zA-Z]:\/)/, "");
  const drive = normalized.match(/^[a-zA-Z]:/)?.[0] ?? "";
  const absolute = normalized.startsWith("/") || Boolean(drive);
  const body = drive ? normalized.slice(drive.length) : normalized;
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const prefix = drive ? `${drive}/` : absolute ? "/" : "";
  return `${prefix}${parts.join("/")}`;
}

export function isMarkdownDocumentPath(value: string): boolean {
  return /\.(?:md|markdown)$/i.test(value.split(/[?#]/, 1)[0]);
}

export function isSupportedLocalDocumentPath(value: string): boolean {
  return isSupportedDocumentPath(value.split(/[?#]/, 1)[0]);
}

/**
 * Resolves a supported local document link without asking the browser to turn
 * it into a tauri.localhost HTTP URL. Returns null for external or unsupported links.
 */
export function resolveLocalDocumentPath(href: string, baseDir: string): string | null {
  if (!href || href.startsWith("#")) return null;
  const lower = href.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("mailto:")) return null;

  let candidate = href;
  if (/^\/\?\/[a-zA-Z]:\//.test(href)) {
    candidate = href.slice(3);
  } else if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const url = new URL(href);
      if (url.hostname !== "tauri.localhost") return null;
      // WebView2 may expose an app-local absolute Windows path as
      // http://tauri.localhost/?/C:/path/to/file.md.
      const queryPath = url.search.startsWith("?/") && /^[a-zA-Z]:\//.test(url.search.slice(2))
        ? url.search.slice(2)
        : "";
      candidate = queryPath || url.pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
  } else if (lower.startsWith("file://")) {
    try {
      candidate = new URL(href).pathname.replace(/^\/(?=[a-zA-Z]:)/, "");
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !isWindowsAbsolutePath(href)) {
    return null;
  }

  candidate = decodePath(candidate.split(/[?#]/, 1)[0])
    .replace(/^\/\?\/(?=[a-zA-Z]:\/)/, "");
  if (!isSupportedLocalDocumentPath(candidate)) return null;
  if (isAbsoluteLocalPath(candidate)) return normalizeLocalPath(candidate);
  return normalizeLocalPath(`${baseDir.replace(/[\\/]$/, "")}/${candidate}`);
}

/** Resolves a Markdown document reference relative to an spmd source. */
export function resolveSharePointDocumentPath(href: string, documentPath?: string): string | null {
  if (!href || href.startsWith("#")) return null;
  const directSpmd = href.toLowerCase().startsWith("spmd://");
  if (!directSpmd && !documentPath?.toLowerCase().startsWith("spmd://")) return null;
  try {
    const resolved = directSpmd ? new URL(href) : new URL(href, documentPath);
    if (resolved.protocol !== "spmd:" || !resolved.hostname.toLowerCase().endsWith(".sharepoint.com")) return null;
    if (resolved.username || resolved.password || resolved.port || resolved.search) return null;
    if (!/^\/(?:sites|teams)\/[^/]+\//i.test(resolved.pathname)) return null;
    if (!isMarkdownDocumentPath(resolved.pathname)) return null;
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Compatibility alias for callers that still use the original Markdown-only name. */
export const resolveLocalMarkdownPath = resolveLocalDocumentPath;
