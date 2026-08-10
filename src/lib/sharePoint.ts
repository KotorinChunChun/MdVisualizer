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

export function listenForSharePointAuthentication(
  handler: EventCallback<SharePointAuthPrompt>,
): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<SharePointAuthPrompt>(SHAREPOINT_AUTH_EVENT, handler);
}
