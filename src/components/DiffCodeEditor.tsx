import { useLayoutEffect, useRef } from "react";
import { EditorState, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { mergeLines, type MergeRow } from "../lib/documentMerge";

export const DIFF_LINE_HEIGHT = 22;
/** `base` は3-wayでのみ表示する読込時本文。採用元のlocalとは別の表示列である。 */
export type DiffColumn = "base" | "storage" | "local" | "result";
const setRows = StateEffect.define<{ rows: readonly MergeRow[]; column: DiffColumn; active?: string }>();
class MissingLines extends WidgetType {
  constructor(readonly count: number) { super(); }
  eq(other: MissingLines) { return this.count === other.count; }
  toDOM() { const div = document.createElement("div"); div.className = "diff-code-gap";
    div.style.height = `${this.count * DIFF_LINE_HEIGHT}px`; div.setAttribute("aria-hidden", "true"); return div; }
  get estimatedHeight() { return this.count * DIFF_LINE_HEIGHT; }
}
const alignedLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setRows)) {
      const decorations: Range<Decoration>[] = [];
      const { rows, column, active } = effect.value;
      let missing = 0;
      for (const row of rows) {
        // MergeRow.base は行番号を持たない原文文字列である。base:N はその原文の
        // N+1行目に一対一対応するため、表示専用のセルへ安全に復元する。
        const baseIndex = column === "base" ? /^base:(\d+)$/.exec(row.id)?.[1] : undefined;
        const cell = column === "base"
          ? (baseIndex !== undefined && row.base !== undefined ? { line: Number(baseIndex) + 1, text: row.base } : undefined)
          : row[column];
        if (!cell) { missing++; continue; }
        if (cell.line > transaction.state.doc.lines) continue;
        const position = transaction.state.doc.line(cell.line).from;
        if (missing) decorations.push(Decoration.widget({ widget: new MissingLines(missing), block: true, side: -1 }).range(position));
        missing = 0;
        decorations.push(Decoration.line({ attributes: { "data-diff-row": row.id, "data-source-line": String(cell.line) },
          class: `${row.changed ? "is-changed" : ""}${active === row.id ? " is-current" : ""}` }).range(position));
      }
      if (missing) decorations.push(Decoration.widget({ widget: new MissingLines(missing), block: true, side: 1 }).range(transaction.state.doc.length));
      next = Decoration.set(decorations, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 全列が同じエンジン・行高・余白を使う。行採用の位置を曖昧にしないため折返しはしない。 */
export function DiffCodeEditor({ value, label, column, rows, readOnly, activeRow, onActivate, onChange, onSave, onUndo, onRedo }: {
  value: string; label: string; column: DiffColumn; rows: readonly MergeRow[]; readOnly: boolean; activeRow?: string;
  onActivate: (row: string) => void; onChange?: (value: string) => void; onSave?: () => void; onUndo?: () => void; onRedo?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave, onUndo, onRedo, onActivate, value });
  callbacks.current = { onChange, onSave, onUndo, onRedo, onActivate, value };
  const applying = useRef(false);
  useLayoutEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: mergeLines(value).join("\n"), extensions: [
      lineNumbers(), drawSelection(), highlightActiveLine(), markdown(), syntaxHighlighting(defaultHighlightStyle),
      EditorState.tabSize.of(4), EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), alignedLines,
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
      keymap.of([{ key: "Mod-s", run: () => { callbacks.current.onSave?.(); return true; } },
        { key: "Mod-z", run: () => { callbacks.current.onUndo?.(); return true; } },
        { key: "Mod-y", run: () => { callbacks.current.onRedo?.(); return true; } },
        { key: "Mod-Shift-z", run: () => { callbacks.current.onRedo?.(); return true; } }, indentWithTab, ...defaultKeymap]),
      EditorView.domEventHandlers({ click: (event) => {
        const row = (event.target as Element)?.closest<HTMLElement>("[data-diff-row]")?.dataset.diffRow;
        if (row) callbacks.current.onActivate(row); return false;
      } }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applying.current || readOnly) return;
        const original = callbacks.current.value;
        const separator = original.includes("\r\n") ? "\r\n" : original.includes("\r") ? "\r" : "\n";
        callbacks.current.onChange?.(update.state.doc.toString().replace(/\n/g, separator));
      }),
    ] }) });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
  }, [readOnly, label]);
  useLayoutEffect(() => {
    const view = viewRef.current; if (!view) return;
    const content = mergeLines(value).join("\n"), old = view.state.doc.toString();
    applying.current = true;
    try {
      // 共通前後を残し、採用やUndoでカーソルとスクロールを不要にリセットしない。
      let prefix = 0, suffix = 0;
      while (prefix < old.length && prefix < content.length && old[prefix] === content[prefix]) prefix++;
      while (suffix < old.length - prefix && suffix < content.length - prefix && old[old.length - suffix - 1] === content[content.length - suffix - 1]) suffix++;
      view.dispatch({ ...(old === content ? {} : { changes: { from: prefix, to: old.length - suffix, insert: content.slice(prefix, content.length - suffix) } }),
        effects: setRows.of({ rows, column, active: activeRow }) });
    } finally { applying.current = false; }
  }, [value, rows, column, activeRow, readOnly, label]);
  return <div className="diff-code-editor" ref={host} data-column={column} />;
}
