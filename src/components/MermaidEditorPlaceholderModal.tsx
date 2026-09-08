import { useEffect, useId } from "react";
import { createPortal } from "react-dom";

export function MermaidEditorPlaceholderModal({ source, onClose }: { source: string; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(<div className="mermaid-editor-placeholder" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <header><strong id={titleId}>Mermaid GUI編集</strong><button type="button" aria-label="Mermaid GUI編集を閉じる" onClick={onClose}>×</button></header>
      <div className="mermaid-editor-placeholder__body">
        <div className="mermaid-editor-placeholder__icon" aria-hidden="true">✎</div>
        <p>Mermaid専用GUI編集ツールを準備中です。</p>
        <small>今回は編集画面の起動入口まで実装しています。詳しい編集機能は今後追加します。</small>
        <details><summary>現在のMermaidコード</summary><pre><code>{source}</code></pre></details>
      </div>
      <footer><button type="button" onClick={onClose}>閉じる</button></footer>
    </section>
  </div>, document.body);
}
