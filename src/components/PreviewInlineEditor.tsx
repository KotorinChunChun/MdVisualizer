import React from "react";
import type { PreviewInlineEditLeaf } from "../lib/previewInlineEdit";
import "../styles/preview-inline-edit.css";

export function PreviewInlineEditor({ leaf, onCommit, onCancel }: { leaf: PreviewInlineEditLeaf; onCommit: (value: string) => boolean | string | void; onCancel: () => void }) {
  const [value, setValue] = React.useState(leaf.value);
  const [error, setError] = React.useState<string | null>(null);
  const composing = React.useRef(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const committed = React.useRef(false);
  const commit = () => {
    if (committed.current) return;
    const preview = inputRef.current?.closest<HTMLElement>(".markdown-body");
    const result = onCommit(value);
    if (result === false || typeof result === "string") { setError(typeof result === "string" ? result : "本文が外部で変更されたため、編集を適用できません。入力内容は保持しています。"); return; }
    committed.current = true;
    onCancel();
    preview?.focus({ preventScroll: true });
  };
  const input = <textarea ref={inputRef} className="preview-inline-editor" aria-label="プレビューのテキストを編集" rows={Math.max(1, value.split(/\r\n|\r|\n/).length)} value={value}
    onChange={(event) => setValue(event.target.value)}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      else if (event.key === "Enter" && !composing.current && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") event.stopPropagation();
    }}
    onBlur={commit} />;
  return <span className="preview-inline-editor-wrap">{input}{error && <span className="preview-inline-editor__error" role="alert">{error}</span>}</span>;
}
