import { useEffect } from "react";
import { createPortal } from "react-dom";
import { SHORTCUTS } from "../lib/shortcuts";
import "../styles/shortcut-help.css";

export function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="shortcut-help__window">
        <header>
          <h2 id="shortcut-help-title">ショートカットキー</h2>
          <button type="button" aria-label="ショートカット一覧を閉じる" onClick={onClose}>×</button>
        </header>
        <dl>
          {SHORTCUTS.map((shortcut) => <div key={shortcut.keys}>
            <dt><kbd>{shortcut.keys}</kbd></dt>
            <dd>{shortcut.description}</dd>
          </div>)}
        </dl>
      </section>
    </div>,
    document.body,
  );
}
