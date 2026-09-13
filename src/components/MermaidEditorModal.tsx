import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mermaidEditorDocument } from "../generated/mermaidEditorDocument";
import type { DiagramSave } from "../features/codex/DiagramCodexAction";

export interface MermaidEditorModalProps {
  source: string;
  onApply: DiagramSave;
  onClose: () => void;
}

/** Hosts the independently testable Mermaid Studio without granting it file ownership. */
export function MermaidEditorModal({ source, onApply, onClose }: MermaidEditorModalProps) {
  const titleId = useId();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const nonceRef = useRef(crypto.randomUUID());
  const baseSourceRef = useRef(source);
  const [ready, setReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data as { kind?: string; nonce?: string; source?: unknown };
      if (data.kind === "mdvisualizer-mermaid-ready") {
        baseSourceRef.current = source;
        setReady(true);
        frameRef.current?.contentWindow?.postMessage({ kind: "mdvisualizer-mermaid-source", nonce: nonceRef.current, source }, "*");
        return;
      }
      if (data.nonce !== nonceRef.current) return;
      if (data.kind === "mdvisualizer-mermaid-current-source" && typeof data.source === "string") {
        if (source !== baseSourceRef.current) { setApplying(false); setError("元のMermaidコードが別の操作で変更されています。画面を閉じて開き直してください。"); return; }
        void Promise.resolve(onApply(data.source)).then((accepted) => {
          if (accepted === false) { setApplying(false); return; }
          onClose();
        }).catch((applyError) => { setApplying(false); setError(applyError instanceof Error ? applyError.message : String(applyError)); });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onApply, onClose, source]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !applying) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applying, onClose]);

  const apply = () => {
    const frame = frameRef.current?.contentWindow;
    if (!frame || !ready) return;
    setApplying(true);
    setError(undefined);
    frame.postMessage({ kind: "mdvisualizer-mermaid-request-current-source", nonce: nonceRef.current }, "*");
  };

  return createPortal(<div className="mermaid-editor-modal" onClick={() => !applying && onClose()}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <header><strong id={titleId}>Mermaid GUI編集</strong><button type="button" aria-label="Mermaid GUI編集を閉じる" disabled={applying} onClick={onClose}>×</button></header>
      <iframe ref={frameRef} title="Mermaid GUI編集" sandbox="allow-scripts allow-same-origin allow-modals allow-forms" srcDoc={mermaidEditorDocument} />
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={applying} onClick={onClose}>キャンセル</button><button className="primary" type="button" disabled={!ready || applying} onClick={apply}>{applying ? "反映中…" : "反映"}</button></footer>
    </section>
  </div>, document.body);
}
