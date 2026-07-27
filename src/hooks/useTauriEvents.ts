import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

interface EventPayload {
  path: string;
}

export function useTauriEvents(
  onMarkdownChanged: (path: string) => void,
  onImageChanged: (path: string) => void
) {
  useEffect(() => {
    let unlistenMarkdown: (() => void) | null = null;
    let unlistenImage: (() => void) | null = null;

    async function setup() {
      unlistenMarkdown = await listen<EventPayload>("markdown-changed", (event) => {
        onMarkdownChanged(event.payload.path);
      });

      unlistenImage = await listen<EventPayload>("image-changed", (event) => {
        onImageChanged(event.payload.path);
      });
    }

    setup();

    return () => {
      if (unlistenMarkdown) unlistenMarkdown();
      if (unlistenImage) unlistenImage();
    };
  }, [onMarkdownChanged, onImageChanged]);
}
