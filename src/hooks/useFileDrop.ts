import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isMarkdownPath } from "../lib/pathIdentity";

export function useFileDrop(onDrop: (paths: string[]) => void): void {
  const callbackRef = useRef(onDrop);
  callbackRef.current = onDrop;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const markdownPaths = event.payload.paths.filter(isMarkdownPath);
      if (markdownPaths.length > 0) callbackRef.current(markdownPaths);
    }).then((remove) => {
      if (disposed) remove();
      else unlisten = remove;
    }).catch((error) => {
      // Browser-based tests and previews do not expose Tauri's WebView API.
      console.error("Failed to subscribe to file drop events:", error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

