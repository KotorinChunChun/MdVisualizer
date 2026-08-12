import { useEffect, useMemo, useRef } from "react";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { foldAll, foldEffect, foldService, unfoldAll } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { buildMarkdownEdit, type MarkdownEditAction } from "../lib/markdownEditing";
import { findBase64FoldRange } from "../lib/base64Folding";
import "../styles/markdown-editor.css";

interface MarkdownEditorProps {
  documentId: string;
  value: string;
  dirty: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

const TOOLBAR_ACTIONS: Array<{ action: MarkdownEditAction; label: string; title: string }> = [
  { action: "heading", label: "H", title: "見出し" },
  { action: "bold", label: "B", title: "太字" },
  { action: "italic", label: "I", title: "斜体" },
  { action: "strike", label: "S", title: "取り消し線" },
  { action: "quote", label: "❯", title: "引用" },
  { action: "unordered-list", label: "•", title: "箇条書き" },
  { action: "ordered-list", label: "1.", title: "番号付きリスト" },
  { action: "task-list", label: "☑", title: "チェックリスト" },
  { action: "link", label: "🔗", title: "リンク" },
  { action: "inline-code", label: "</>", title: "インラインコード" },
  { action: "code-block", label: "```", title: "コードブロック" },
  { action: "table", label: "表", title: "表を挿入" },
  { action: "mermaid", label: "Mermaid", title: "Mermaid図を挿入" },
  { action: "horizontal-rule", label: "―", title: "水平線" },
  { action: "drawio", label: "+ draw.io", title: "draw.io図を挿入" },
  { action: "image", label: "画像", title: "画像を挿入" },
];

const editorTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--text-primary)", backgroundColor: "var(--bg-color)" },
  ".cm-scroller": { fontFamily: 'Consolas, "Cascadia Code", monospace', lineHeight: "1.55" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--text-primary)" },
  ".cm-gutters": { backgroundColor: "var(--panel-bg)", color: "var(--text-muted)", borderColor: "var(--border-color)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent-color) 10%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent-color) 28%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--text-primary)" },
});

const base64FoldService = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  return findBase64FoldRange(line.text, line.from);
});

function foldBase64Data(view: EditorView) {
  const effects = [];
  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number);
    const range = findBase64FoldRange(line.text, line.from);
    if (range) effects.push(foldEffect.of(range));
  }
  if (effects.length) view.dispatch({ effects });
}

export function MarkdownEditor({ documentId, value, dirty, saving, onChange, onSave }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const applyingExternal = useRef(false);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  const lineSeparator = useMemo(() => value.includes("\r\n") ? "\r\n" : value.includes("\r") ? "\r" : "\n", [documentId]);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        markdown({ base: markdownLanguage }),
        EditorState.lineSeparator.of(lineSeparator),
        EditorView.lineWrapping,
        base64FoldService,
        editorTheme,
        EditorView.contentAttributes.of({ "aria-label": "Markdownを編集", spellcheck: "true" }),
        keymap.of([
          indentWithTab,
          { key: "Mod-s", run: () => { onSaveRef.current(); return true; } },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal.current) onChangeRef.current(update.state.sliceDoc());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    foldBase64Data(view);
    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [documentId, lineSeparator]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.sliceDoc() === value) return;
    applyingExternal.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    foldBase64Data(view);
    applyingExternal.current = false;
  }, [value]);

  const apply = (action: MarkdownEditAction) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const change = buildMarkdownEdit(view.state.sliceDoc(), selection.from, selection.to, action);
    view.dispatch({
      changes: { from: change.from, to: change.to, insert: change.insert },
      selection: { anchor: change.anchor, head: change.head },
      scrollIntoView: true,
      userEvent: "input.toolbar",
    });
    view.focus();
  };

  return <section className="markdown-editor" aria-label="Markdown編集">
    <div className="markdown-editor__toolbar" role="toolbar" aria-label="Markdown書式">
      {TOOLBAR_ACTIONS.map((item) => <button key={item.action} type="button" title={item.title} aria-label={item.title} onClick={() => apply(item.action)}>{item.label}</button>)}
      <span className="markdown-editor__toolbar-spacer" />
      <button type="button" title="すべて折りたたむ" onClick={() => { const view = viewRef.current; if (view) foldAll(view); }}>折りたたむ</button>
      <button type="button" title="すべて展開" onClick={() => { const view = viewRef.current; if (view) unfoldAll(view); }}>展開</button>
      <button type="button" className="markdown-editor__save" disabled={!dirty || saving} onClick={onSave}>{saving ? "保存中…" : "保存"}</button>
    </div>
    <div className="markdown-editor__surface" ref={hostRef} />
  </section>;
}
