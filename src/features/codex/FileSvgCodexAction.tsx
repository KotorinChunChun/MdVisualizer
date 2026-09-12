import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadMarkdown, saveMarkdown } from "../../lib/commands";
import type { MarkdownLoadResult } from "../../types/app";
import { DiagramCodexDialog } from "./DiagramCodexAction";

/** 元ファイルはクリック時に読み、採用時だけ読込revisionを条件に保存する。 */
export function FileSvgCodexAction({ path, onSaved }: { path: string; onSaved?: () => void }) {
  const [loaded, setLoaded] = useState<MarkdownLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => { generation.current++; setLoaded(null); setError(""); setLoading(false); return () => { generation.current++; }; }, [path]);
  async function open() {
    if (loading) return;
    const token = ++generation.current;
    setLoading(true); setError("");
    try {
      const document = await loadMarkdown(path);
      if (token !== generation.current) return;
      if (document.kind !== "svg") throw new Error("SVGファイルを選択してください。");
      setLoaded(document);
    } catch (cause) { if (token === generation.current) setError(String(cause)); }
    finally { if (token === generation.current) setLoading(false); }
  }
  return <>
    <button type="button" className="diagram-action-button codex-diagram-action" disabled={loading} onClick={() => void open()}>{loading ? "SVG読込中…" : "Codexに図を依頼"}</button>
    {error && <span role="alert">{error}</span>}
    {loaded && createPortal(<DiagramCodexDialog kind="svg" source={loaded.content} label={path.split(/[\\/]/).pop() ?? "SVG"} theme="dark" onClose={() => setLoaded(null)} onSave={async (content) => {
      const result = await saveMarkdown({ path: loaded.path, content, expectedRevision: loaded.revision, stagedAssetIds: [] });
      if (result.status === "conflict") throw new Error("SVGファイルが外部で更新されています。閉じて開き直してください。変更案は保存していません。");
      setLoaded(result.document);
      onSaved?.();
      return true;
    }} />, document.body)}
  </>;
}
