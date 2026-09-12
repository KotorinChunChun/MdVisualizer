import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { CodexPanel } from "./CodexPanel";
import type { CodexDiagramKind } from "./diagram";
import { DrawioBlock } from "../../components/DrawioBlock";

export type DiagramSave = (source: string) => boolean | void | Promise<boolean | void>;

export function DiagramCodexAction({ kind, source, onSave, label, theme = "dark" }: {
  kind: CodexDiagramKind; source: string; onSave: DiagramSave; label?: string; theme?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="diagram-action-button codex-diagram-action" type="button" onClick={() => setOpen(true)}>Codexに図を依頼</button>
    {open && createPortal(<DiagramCodexDialog kind={kind} source={source} onSave={onSave} label={label ?? kind} theme={theme} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

export function DiagramCodexDialog({ kind, source, onSave, label, theme, onClose }: {
  kind: CodexDiagramKind; source: string; onSave: DiagramSave; label: string; theme: string; onClose: () => void;
}) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  const id = useRef(crypto.randomUUID());
  const latest = useRef({ source, onSave });
  latest.current = { source, onSave };
  return <div ref={ref} role="dialog" aria-modal="true" aria-label={`Codexで${kind === "svg" ? "SVG" : "draw.io"}を編集`} className="codex-diagram-dialog" onKeyDown={(event) => event.stopPropagation()}>
    <CodexPanel open onClose={onClose} documentName={label} documentText={source} available diagramKind={kind}
      getSnapshot={() => ({ documentId: id.current, content: latest.current.source, from: 0, to: latest.current.source.length })}
      applyProposal={() => false}
      applyProposalAsync={async (base, replacement) => {
        if (base.documentId !== id.current || base.content !== latest.current.source) return false;
        const accepted = await latest.current.onSave(replacement);
        if (accepted === false) return false;
        return true;
      }}
      renderProposal={(replacement) => kind === "svg"
        ? <div className="codex-diagram-preview" aria-label="SVG変更案" dangerouslySetInnerHTML={{ __html: replacement }} />
        : <div className="codex-diagram-preview" aria-label="draw.io変更案"><DrawioBlock source={replacement} theme={theme} blockId="codex-proposal" /></div>}
    />
  </div>;
}
