import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { buildDocumentDiff } from "../lib/documentDiff";
import { MarkdownPreview } from "./MarkdownPreview";
import "../styles/document-diff.css";

export interface DocumentDiffTarget {
  path: string;
  baseDir: string;
  openedContent: string;
  storageContent: string;
  editingContent: string;
}

function filename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function DocumentDiffModal({ target, theme, onClose }: {
  target: DocumentDiffTarget;
  theme: string;
  onClose: () => void;
}) {
  const [display, setDisplay] = useState<"code" | "rendered">("code");
  const model = useMemo(
    () => buildDocumentDiff(target.openedContent, target.storageContent, target.editingContent),
    [target.editingContent, target.openedContent, target.storageContent],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="document-diff-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="document-diff" role="dialog" aria-modal="true" aria-label={`${filename(target.path)}の差分`}>
        <header className="document-diff__header">
          <div>
            <strong>{filename(target.path)}の差分</strong>
            <small>{model.mode === "three-way" ? "3-way（ストレージに外部変更あり）" : "2-way（ストレージに外部変更なし）"}</small>
          </div>
          <div className="document-diff__actions" role="group" aria-label="差分表示">
            <button type="button" aria-pressed={display === "code"} onClick={() => setDisplay("code")}>コード</button>
            <button type="button" aria-pressed={display === "rendered"} onClick={() => setDisplay("rendered")}>レンダリング</button>
            <button type="button" aria-label="差分を閉じる" onClick={onClose}>×</button>
          </div>
        </header>
        <div className={`document-diff__panes document-diff__panes--${model.mode}`}>
          {model.versions.map((version) => (
            <article className="document-diff__pane" key={version.id}>
              <header>{version.label}<small>{version.changedLines.size}変更行</small></header>
              {display === "code" ? (
                <ol className="document-diff__code">
                  {version.content.replace(/\r\n?/g, "\n").split("\n").map((line, index) => (
                    <li key={index} className={version.changedLines.has(index + 1) ? "is-changed" : undefined}>
                      <code>{line || " "}</code>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="document-diff__rendered">
                  <MarkdownPreview
                    content={version.content}
                    baseDir={target.baseDir}
                    imageVersions={{}}
                    theme={theme}
                    mermaidMode="always-code"
                    diffChangedLines={version.changedLines}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
