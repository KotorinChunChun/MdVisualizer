import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadMarkdown, saveMarkdown } from "../../lib/commands";
import type { MarkdownLoadResult } from "../../types/app";
import { DiagramCodexDialog } from "./DiagramCodexAction";

/** 元ファイルはクリック時に読み、採用時だけ読込revisionを条件に保存する。 */
export function FileSvgCodexAction({ path, onSaved, kind = "svg", children }: { path: string; onSaved?: () => void; kind?: "svg" | "mermaid"; children?: React.ReactNode }) {
  const [loaded, setLoaded] = useState<MarkdownLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key, true); };
  }, [menu]);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setLoaded(null); setError(""); setLoading(false); return () => { generation.current++; }; }, [path]);
  async function open() {
    if (loading) return;
    const token = ++generation.current;
    setLoading(true); setError("");
    try {
      const document = await loadMarkdown(path);
      if (token !== generation.current) return;
      if (document.kind !== kind) throw new Error(`${kind}ファイルを選択してください。`);
      setLoaded(document);
    } catch (cause) { if (token === generation.current) setError(String(cause)); }
    finally { if (token === generation.current) setLoading(false); }
  }
  return <div data-codex-file={children ? "true" : undefined} onContextMenuCapture={children ? (event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 80)) }); } : undefined}>
    {children}
    {menu && createPortal(<div role="menu" aria-label="図の相談" className="responsive-toolbar__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}><button autoFocus type="button" role="menuitem" onClick={() => { setMenu(null); void open(); }}>Codexに相談</button></div>, document.body)}
    {!children && <button type="button" className="diagram-action-button codex-diagram-action" disabled={loading} onClick={() => void open()}>{loading ? `${kind}読込中…` : "Codexに図を依頼"}</button>}
    {error && <span role="alert">{error}</span>}
    {loaded && createPortal(<DiagramCodexDialog kind={kind} source={loaded.content} label={path.split(/[\\/]/).pop() ?? kind} theme="dark" onClose={() => setLoaded(null)} onSave={async (content) => {
      if (kind === "mermaid") {
        const { default: mermaid } = await import("mermaid");
        await mermaid.parse(content);
      }
      const result = await saveMarkdown({ path: loaded.path, content, expectedRevision: loaded.revision, stagedAssetIds: [] });
      if (result.status === "conflict") throw new Error("図のファイルが外部で更新されています。閉じて開き直してください。変更案は保存していません。");
      setLoaded(result.document);
      onSaved?.();
      return true;
    }} />, document.body)}
  </div>;
}
