import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

export const SHAREPOINT_AUTH_EVENT = "sharepoint-authentication-required";

export interface SharePointAuthPrompt {
  userCode: string;
  verificationUri: string;
  message: string;
  expiresIn: number;
}

export function isSpmdUri(value: string): boolean {
  return /^spmd:\/\//i.test(value.trim());
}

export function isSharePointDocument(source: { path: string; source?: string } | null | undefined): boolean {
  return source?.source === "sharepoint" || Boolean(source && isSpmdUri(source.path));
}

function encodeSharePointQueryPath(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return /[A-Za-z0-9]/.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

function decodedPathname(url: URL): string | null {
  try {
    return url.pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

/** Resolves a non-Markdown link in an spmd document to the same tenant's HTTPS URL. */
export function resolveSharePointBrowserUrl(href: string, documentPath?: string): string | null {
  if (!href || href.startsWith("#") || !documentPath || !isSpmdUri(documentPath)) return null;
  try {
    const source = new URL(documentPath);
    const resolved = new URL(href, source);
    if (resolved.protocol !== "spmd:" || resolved.hostname !== source.hostname || resolved.username || resolved.password || resolved.port) return null;
    if (/\.(?:md|markdown)$/i.test(resolved.pathname)) return null;
    return `https://${resolved.hostname}${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

/** Builds the document-library view URL that selects the spmd file. */
export function sharePointLibraryViewUrl(documentPath: string): string | null {
  if (!isSpmdUri(documentPath)) return null;
  try {
    const source = new URL(documentPath);
    if (!source.hostname.toLowerCase().endsWith(".sharepoint.com") || source.username || source.password || source.port || source.search || source.hash) return null;
    const path = decodedPathname(source);
    if (!path) return null;
    const segments = path.split("/").filter(Boolean);
    if (segments.length < 4 || !["sites", "teams"].includes(segments[0].toLowerCase())) return null;
    const libraryRoot = `/${segments.slice(0, 3).join("/")}`;
    const parent = path.slice(0, path.lastIndexOf("/")) || libraryRoot;
    const formsPath = libraryRoot.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    return `https://${source.hostname}${formsPath}/Forms/AllItems.aspx?id=${encodeSharePointQueryPath(path)}&parent=${encodeSharePointQueryPath(parent)}`;
  } catch {
    return null;
  }
}

export function listenForSharePointAuthentication(
  handler: EventCallback<SharePointAuthPrompt>,
): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<SharePointAuthPrompt>(SHAREPOINT_AUTH_EVENT, handler);
}
