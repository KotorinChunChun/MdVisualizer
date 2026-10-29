import { useEffect, useRef } from "react";

/** ファイル選択を二重に開かず、無効な間はWebView既定のCtrl+Oも抑止する。 */
export function useDocumentOpenShortcut(open: () => Promise<void>, enabled: boolean) {
  const pending = useRef(false);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "o" || event.defaultPrevented) return;
      event.preventDefault();
      if (!enabled || pending.current || event.repeat) return;
      pending.current = true;
      void open().then(() => { pending.current = false; }, () => { pending.current = false; });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, enabled]);
}
