import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

export const SECONDARY_LAUNCH_EVENT = "open-markdown-in-new-window";

/**
 * Listens on this WebViewWindow instead of the app-wide event bus. Rust targets
 * exactly one owner window, so only that window may create secondary windows.
 */
export function listenForSecondaryLaunches(
  handler: EventCallback<string[]>,
): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<string[]>(SECONDARY_LAUNCH_EVENT, handler);
}
