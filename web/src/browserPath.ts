import { assetBase, resolveAssetPath } from "./workspace";
import { browserBridge } from "./browserBridge";

export function resolveLocalImagePath(source: string, baseDir: string): string | null {
  if (!source || /^(?:data:|https?:|blob:|file:|\/\/)/i.test(source)) return null;
  try { return resolveAssetPath(source, baseDir); } catch { return null; }
}
export function resolveImageSrc(source: string, baseDir: string): string {
  if (/^(?:data:|https?:|blob:|file:|#)/i.test(source)) return source;
  try { return browserBridge().workspace.resolve(source, baseDir); } catch { return source; }
}
export function resolveLocalDocumentPath(source: string, baseDir: string): string | null { return resolveLocalImagePath(source, baseDir); }
export function resolveSharePointDocumentPath(): string | null { return null; }
export function getFileName(value: string): string { return value.replace(/\\/g, "/").split("/").pop() || value; }
export function stripWindowsExtendedPathPrefix(value: string): string { return value.replace(/^\\\\\?\\/, ""); }
export function resolvePathBase(path: string): string { return assetBase(path); }
