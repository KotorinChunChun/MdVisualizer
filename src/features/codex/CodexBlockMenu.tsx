import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCodexSkills, visibleSkills, type CodexSkill } from "./skills";
import type { CodexTarget } from "./scope";

export function CodexBlockMenu({ target, onConsult }: { target: CodexTarget; onConsult: (target: CodexTarget) => void }) {
  const skills = useCodexSkills();
  const [selected, setSelected] = useState<CodexSkill | null>(null);
  const [position, setPosition] = useState<{ top: number; right: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const actions = visibleSkills(skills, target.targetKind ?? "code", "blockMenu");
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(undefined);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); trigger.current?.focus(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [position]);
  if (!actions.length) return null;
  function choose(conversationAction: "add" | "new") {
    if (selected) onConsult({ ...target, skillId: selected.id, editMode: selected.config.mode, conversationAction });
    setPosition(undefined); setSelected(null);
  }
  return <>
    <button type="button" className="diagram-action-button" ref={trigger} aria-label="AIブロック操作" aria-haspopup="menu" aria-expanded={!!position} onPointerDown={event => event.stopPropagation()} onClick={() => {
      const rect = trigger.current?.getBoundingClientRect();
      setSelected(null); setPosition(position ? undefined : rect ? { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) } : undefined);
    }}>AI</button>
    {position && createPortal(<div className="responsive-toolbar__menu" role="menu" aria-label="AIブロック操作" style={position} onPointerDown={event => event.stopPropagation()}>
      {selected ? <><button type="button" role="menuitem" onClick={() => choose("add")}>現在の会話に追加</button><button type="button" role="menuitem" onClick={() => choose("new")}>新しい会話を開始</button></> : actions.map(skill => <button type="button" role="menuitem" key={skill.id} onClick={() => setSelected(skill)}>{skill.config.label}</button>)}
    </div>, document.body)}
  </>;
}
