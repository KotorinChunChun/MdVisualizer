import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

export type FileChangeKind = "modified" | "created" | "deleted" | "renamed" | "replaced";

export interface FileChangedPayload {
  windowLabel: string;
  path: string;
  changeKind: FileChangeKind;
}

export function useTauriEvents(
  onMarkdownChanged: (payload: FileChangedPayload) => void,
  onImageChanged: (payload: FileChangedPayload) => void
) {
  const callbacksRef = useRef({ onMarkdownChanged, onImageChanged });
  // Keep event handlers current without tearing down and re-registering the
  // Tauri listeners whenever tab, scroll, or search state changes.
  callbacksRef.current = { onMarkdownChanged, onImageChanged };

  useEffect(() => {
    let disposed = false;
    let unlistenMarkdown: (() => void) | null = null;
    let unlistenImage: (() => void) | null = null;

    async function setup() {
      try {
        const removeMarkdown = await listen<FileChangedPayload>("markdown-changed", (event) => {
          callbacksRef.current.onMarkdownChanged(event.payload);
        });
        if (disposed) {
          removeMarkdown();
          return;
        }
        unlistenMarkdown = removeMarkdown;

        const removeImage = await listen<FileChangedPayload>("image-changed", (event) => {
          callbacksRef.current.onImageChanged(event.payload);
        });
        if (disposed) {
          removeImage();
          return;
        }
        unlistenImage = removeImage;
      } catch (error) {
        // Tauri may be unavailable in a browser/test host.  Consume the
        // rejection so mounting the viewer never produces an unhandled one.
        console.error("Failed to subscribe to Tauri file events:", error);
      }
    }

    void setup();

    return () => {
      disposed = true;
      if (unlistenMarkdown) unlistenMarkdown();
      if (unlistenImage) unlistenImage();
    };
  }, []);
}
