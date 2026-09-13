import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { targetAtLine, type CodexTarget } from "./scope";
import { sourceRangeForLines } from "./scope";
import { useCodexSkills, visibleSkills, type SkillTarget } from "./skills";

export interface EditorContextAction { label: string; disabled?: boolean; run: (target: CodexTarget) => void | Promise<void> }

export function useConsultationMenu(content: string, documentId: string, onConsult?: (target: CodexTarget) => void, capture?: (event: MouseEvent<HTMLDivElement>) => CodexTarget | null, editorActions?: EditorContextAction[]) {
  const skills = useCodexSkills();
  const [menu, setMenu] = useState<{ x: number; y: number; target: CodexTarget; options: ReturnType<typeof visibleSkills>; selectedSkill?: ReturnType<typeof visibleSkills>[number] } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key, true); };
  }, [menu]);
  return {
    onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => {
      if ((!onConsult && !editorActions?.length) || !(event.target instanceof Element)) return;
      if (event.target.closest("[data-codex-file]")) return;
      if (capture) {
        const target = capture(event);
        if (!target) return;
        event.preventDefault(); event.stopPropagation();
        const targetKind = target.targetKind ?? "text";
        setMenu({ x: Math.min(event.clientX, window.innerWidth - 280), y: Math.min(event.clientY, window.innerHeight - (editorActions?.length ? 350 : 160)), target: { ...target, targetKind }, options: onConsult ? visibleSkills(skills, targetKind, "contextMenu") : [] });
        return;
      }
      const anchor = event.target.closest<HTMLElement>("[data-source-line]");
      if (!anchor) return;
      const selection = window.getSelection();
      const selectedText = selection && selection.anchorNode && event.currentTarget.contains(selection.anchorNode) ? selection.toString() : "";
      const eventElement = event.target;
      const isImage = eventElement.tagName === "IMG";
      const drawioContainer = eventElement.closest(".drawio-block");
      const mermaidContainer = eventElement.closest(".mermaid-container");
      const codeContainer = eventElement.closest(".code-block");
      const inlineSvgContainer = eventElement.closest(".inline-svg-preview");
      const codeLanguage = codeContainer?.querySelector("code")?.className.match(/language-([\w-]+)/)?.[1] ?? "";
      let targetKind: SkillTarget = isImage ? "image"
        : drawioContainer ? "drawio"
          : mermaidContainer ? "mermaid"
            : inlineSvgContainer || eventElement.closest("svg") ? "svg"
              : codeContainer ? (codeLanguage === "svg" ? "svg" : "code")
                : "text";
      const selectionRange = selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode
        ? (() => {
          const fromLine = Number((selection.anchorNode.parentElement?.closest("[data-source-line]") as HTMLElement | null)?.dataset.sourceLine);
          const toLine = Number((selection.focusNode.parentElement?.closest("[data-source-line]") as HTMLElement | null)?.dataset.sourceLine);
          return Number.isFinite(fromLine) && Number.isFinite(toLine) && fromLine !== toLine ? sourceRangeForLines(content, fromLine, toLine) : null;
        })() : null;
      const range = selectionRange ?? targetAtLine(content, Number(anchor.dataset.sourceLine), selectedText, isImage);
      if (!range) return;
      if (isImage && "imageSource" in range && typeof range.imageSource === "string" && range.imageSource.split(/[?#]/)[0].toLowerCase().endsWith(".svg")) targetKind = "svg";
      event.preventDefault(); event.stopPropagation();
      const svg = eventElement.closest("svg")?.outerHTML
        ?? inlineSvgContainer?.querySelector("svg")?.outerHTML
        ?? eventElement.closest(".drawio-block, .mermaid-container, .code-block")?.querySelector("svg")?.outerHTML;
      setMenu({ x: Math.min(event.clientX, window.innerWidth - 280), y: Math.min(event.clientY, window.innerHeight - 160), target: { documentId, content, ...range, targetKind, renderedSvg: svg, ...(isImage && "imageSource" in range ? {} : {}) }, options: visibleSkills(skills, targetKind, "contextMenu") });
    },
    menu: menu && createPortal(<div role="menu" aria-label="対象部分の操作" className="responsive-toolbar__menu" style={{ left: Math.max(0, menu.x), top: Math.max(0, menu.y) }} onPointerDown={(event) => event.stopPropagation()}>
      {!menu.selectedSkill && editorActions?.map(action => <button key={action.label} type="button" role="menuitem" disabled={action.disabled} onClick={() => { void action.run(menu.target); setMenu(null); }}>{action.label}</button>)}
      {!menu.selectedSkill ? menu.options.map((skill) => <button key={skill.id} type="button" role="menuitem" autoFocus={skill === menu.options[0]} onClick={() => setMenu({ ...menu, selectedSkill: skill })}>{skill.config.label}</button>) : <>
        <button type="button" role="menuitem" autoFocus onClick={() => { onConsult?.({ ...menu.target, skillId: menu.selectedSkill!.id, editMode: menu.selectedSkill!.config.mode, conversationAction: "add" }); setMenu(null); }}>現在の会話に追加</button>
        <button type="button" role="menuitem" onClick={() => { onConsult?.({ ...menu.target, skillId: menu.selectedSkill!.id, editMode: menu.selectedSkill!.config.mode, conversationAction: "new" }); setMenu(null); }}>新しい会話を開始</button>
      </>}
      {!editorActions && <button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(menu.target.content.slice(menu.target.from, menu.target.to)).catch(() => {}); setMenu(null); }}>コピー</button>}
    </div>, document.body),
  };
}
