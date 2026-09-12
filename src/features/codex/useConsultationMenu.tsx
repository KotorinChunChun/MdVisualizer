import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { targetAtLine, type CodexTarget } from "./scope";

export function useConsultationMenu(content: string, documentId: string, onConsult?: (target: CodexTarget) => void, capture?: (event: MouseEvent<HTMLDivElement>) => CodexTarget | null) {
  const [menu, setMenu] = useState<{ x: number; y: number; target: CodexTarget } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key, true); };
  }, [menu]);
  return {
    onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (!onConsult || !(event.target instanceof Element)) return;
      if (event.target.closest("[data-codex-file]")) return;
      if (capture) {
        const target = capture(event);
        if (!target) return;
        event.preventDefault(); event.stopPropagation();
        setMenu({ x: Math.min(event.clientX, window.innerWidth - 200), y: Math.min(event.clientY, window.innerHeight - 100), target });
        return;
      }
      const anchor = event.target.closest<HTMLElement>("[data-source-line]");
      if (!anchor) return;
      const selection = window.getSelection();
      const selectedText = selection && selection.anchorNode && event.currentTarget.contains(selection.anchorNode) ? selection.toString() : "";
      const range = targetAtLine(content, Number(anchor.dataset.sourceLine), selectedText, event.target.tagName === "IMG");
      if (!range) return;
      event.preventDefault(); event.stopPropagation();
      setMenu({ x: Math.min(event.clientX, window.innerWidth - 200), y: Math.min(event.clientY, window.innerHeight - 100), target: { documentId, content, ...range } });
    },
    menu: menu && createPortal(<div role="menu" aria-label="対象部分の操作" className="responsive-toolbar__menu" style={{ left: Math.max(0, menu.x), top: Math.max(0, menu.y) }} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" role="menuitem" autoFocus onClick={() => { onConsult?.(menu.target); setMenu(null); }}>Codexに相談</button>
      <button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(menu.target.content.slice(menu.target.from, menu.target.to)).catch(() => {}); setMenu(null); }}>コピー</button>
    </div>, document.body),
  };
}
