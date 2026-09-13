import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadMarkdown, saveMarkdown } from "../../lib/commands";
import type { MarkdownLoadResult } from "../../types/app";
import { DiagramCodexDialog } from "./DiagramCodexAction";
import { useCodexSkills, visibleSkills } from "./skills";

/** 元ファイルはクリック時に読み、採用時だけ読込revisionを条件に保存する。 */
export function FileSvgCodexAction({ path, onSaved, kind = "svg", children }: { path: string; onSaved?: () => void; kind?: "svg" | "mermaid"; children?: React.ReactNode }) {
  const [loaded, setLoaded] = useState<MarkdownLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; place: "contextMenu" | "blockMenu" } | null>(null);
  const [skillId, setSkillId] = useState<string>();
  const [conversationAction, setConversationAction] = useState<"add" | "new">();
  const skills = useCodexSkills();
  const available = visibleSkills(skills, kind, menu?.place ?? "contextMenu");
  const showMenu = (place: "contextMenu" | "blockMenu", x: number, y: number) => setMenu({ place, x: Math.max(8, Math.min(x, window.innerWidth - 240)), y: Math.max(8, Math.min(y, window.innerHeight - 120)) });
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
  return <div data-codex-file={children ? "true" : undefined} onContextMenuCapture={children ? (event) => { event.preventDefault(); event.stopPropagation(); showMenu("contextMenu", event.clientX, event.clientY); } : undefined}>
    {children}
    {!children && <button type="button" className="diagram-action-button codex-diagram-action" disabled={loading} onClick={(event) => showMenu("blockMenu", event.clientX, event.clientY)}>{loading ? `${kind}読込中…` : "AIに図の編集を依頼"}</button>}
    {menu && createPortal(<div role="menu" aria-label="図のAI操作" className="responsive-toolbar__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {available.map((skill) => <button key={skill.id} autoFocus={skill === available[0]} type="button" role="menuitem" onClick={() => { setSkillId(skill.id); setConversationAction("new"); setMenu(null); void open(); }}>{skill.config.label}</button>)}
      <div role="separator" />
      <button type="button" role="menuitem" onClick={() => { setSkillId(undefined); setConversationAction("add"); setMenu(null); void open(); }}>この画像をAIの送信対象に追加</button>
    </div>, document.body)}
    {error && <span role="alert">{error}</span>}
    {loaded && createPortal(<DiagramCodexDialog documentPath={path} kind={kind} source={loaded.content} label={path.split(/[\\/]/).pop() ?? kind} theme="dark" initialSkillId={skillId} initialConversationAction={conversationAction} onClose={() => { setLoaded(null); setSkillId(undefined); setConversationAction(undefined); }} onSave={async (content) => {
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
