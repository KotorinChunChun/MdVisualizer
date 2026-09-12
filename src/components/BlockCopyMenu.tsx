import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** ポータルで表示し、表やコードカードのoverflowにコピー候補を切らせない。 */
export function BlockCopyMenu({ children }: { children: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    popup.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = () => setPosition(null);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); trigger.current?.focus(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("resize", close); window.addEventListener("scroll", close, true); window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", key, true); };
  }, [position]);
  return <><button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={Boolean(position)} onPointerDown={(event) => event.stopPropagation()} onClick={() => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds || position) { setPosition(null); return; }
    setPosition({ right: Math.max(8, window.innerWidth - bounds.right), ...(bounds.bottom < window.innerHeight / 2 ? { top: bounds.bottom + 4 } : { bottom: window.innerHeight - bounds.top + 4 }) });
  }}>コピー</button>{position && createPortal(<div ref={popup} className="responsive-toolbar__menu" role="menu" aria-label="コピー形式" style={position} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setPosition(null); trigger.current?.focus(); }}>{children}</div>, document.body)}</>;
}
