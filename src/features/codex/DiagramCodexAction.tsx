import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { CodexPanel } from "./CodexPanel";
import type { CodexDiagramKind } from "./diagram";
import { DiagramProposalPreview } from "./DiagramProposalPreview";
import { useCodexSkills, visibleSkills } from "./skills";

export type DiagramSave = (source: string) => boolean | void | Promise<boolean | void>;

export function DiagramCodexAction({ kind, source, onSave, label, theme = "dark", renderedSvg }: {
  kind: CodexDiagramKind; source: string; onSave: DiagramSave; label?: string; theme?: string; renderedSvg?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number }>();
  const [skillId, setSkillId] = useState<string>();
  const [conversationAction, setConversationAction] = useState<"add" | "new">("add");
  const skills = useCodexSkills();
  const target = kind === "svg" ? "svg" : kind;
  const available = visibleSkills(skills, target, "blockMenu");
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [menuOpen]);
  function start(action: "add" | "new") { setConversationAction(action); setMenuOpen(false); setOpen(true); }
  if (!available.length) return null;
  return <>
    <button ref={trigger} className="diagram-action-button codex-diagram-action" type="button" aria-haspopup="menu" aria-expanded={menuOpen} onPointerDown={(event) => event.stopPropagation()} onClick={() => { const bounds = trigger.current?.getBoundingClientRect(); if (bounds) setMenuPosition({ top: bounds.bottom + 4, right: Math.max(8, window.innerWidth - bounds.right) }); setSkillId(undefined); setMenuOpen((value) => !value); }}>AIに図の編集を依頼</button>
    {menuOpen && menuPosition && createPortal(<div className="responsive-toolbar__menu" role="menu" aria-label="図のAI操作" style={menuPosition} onPointerDown={(event) => event.stopPropagation()}>
      {available.map((skill) => <button key={skill.id} type="button" role="menuitem" onClick={() => { setSkillId(skill.id); start("new"); }}>{skill.config.label}</button>)}
      <div role="separator" />
      <button type="button" role="menuitem" onClick={() => { setSkillId(undefined); start("add"); }}>この画像をAIの送信対象に追加</button>
    </div>, document.body)}
    {open && createPortal(<DiagramCodexDialog kind={kind} source={source} onSave={onSave} label={label ?? kind} theme={theme} onClose={() => setOpen(false)} initialSkillId={skillId} initialConversationAction={conversationAction} renderedSvg={renderedSvg} />, document.body)}
  </>;
}

export function DiagramCodexDialog({ kind, source, onSave, label, theme, onClose, initialSkillId, initialConversationAction, renderedSvg, documentPath }: {
  kind: CodexDiagramKind; source: string; onSave: DiagramSave; label: string; theme: string; onClose: () => void;
  initialSkillId?: string; initialConversationAction?: "add" | "new"; renderedSvg?: string; documentPath?: string;
}) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  const id = useRef(crypto.randomUUID());
  const latest = useRef({ source, onSave });
  latest.current = { source, onSave };
  return <div ref={ref} role="dialog" aria-modal="true" aria-label={`AIで${kind === "svg" ? "SVG" : kind === "mermaid" ? "Mermaid" : "draw.io"}を編集`} className="codex-diagram-dialog" onKeyDown={(event) => event.stopPropagation()}>
    <CodexPanel open onClose={onClose} documentName={label} documentPath={documentPath} documentText={source} available diagramKind={kind} initialSkillId={initialSkillId} initialConversationAction={initialConversationAction} renderedSvg={renderedSvg}
      getSnapshot={() => ({ documentId: id.current, content: latest.current.source, from: 0, to: latest.current.source.length })}
      applyProposal={() => false}
      applyProposalAsync={async (base, replacement) => {
        if (base.documentId !== id.current || base.content !== latest.current.source) return false;
        const accepted = await latest.current.onSave(replacement);
        if (accepted === false) return false;
        return true;
      }}
      renderProposal={(replacement) => <DiagramProposalPreview kind={kind} source={replacement} theme={theme} />}
    />
  </div>;
}
