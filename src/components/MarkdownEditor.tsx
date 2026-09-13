import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useConsultationMenu } from "../features/codex/useConsultationMenu";
import type { CodexTarget } from "../features/codex/scope";
import { basicSetup } from "codemirror";
import { indentWithTab, isolateHistory, undo, redo, selectAll } from "@codemirror/commands";
import { canApplyProposal, type EditorSnapshot } from "../features/codex/model";
import { foldEffect, foldService, foldable, foldedRanges, unfoldAll } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import {
  buildContextualMarkdownEdit,
  buildOrderedListNormalization,
  buildStructuredListEnter,
  buildStructuredListSoftEnter,
  buildStructuredListIndent,
  buildStructuredListMove,
  buildStructuredListPaste,
  buildStructuredListToggle,
  detectLineEnding,
  normalizeLineEndings,
  isMarkdownToolbarActionDisabled,
  type MarkdownEditAction,
  type MarkdownEditChange,
  type MarkdownLineEnding,
  type StructuredListKind,
} from "../lib/markdownEditing";
import { findBase64FoldRange } from "../lib/base64Folding";
import { longFencedCodeBlockRanges, mapTextPosition, minimalTextChange, rememberMarkdownEditorViewState, restoreMarkdownEditorViewState } from "../lib/markdownFolding";
import { clipboardImageFile, clipboardImageMarkdown, readClipboardImage, type ClipboardImageData, type ResolvedClipboardImage } from "../lib/clipboardImage";
import type { StagedDocumentAsset } from "../types/app";
import type { EditorCursorPosition } from "../lib/paneSync";
import "../styles/markdown-editor.css";

interface MarkdownEditorProps {
  onCodexConsult?: (target: CodexTarget) => void;
  documentId: string;
  value: string;
  dirty: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onResolvePastedImage?: (image: ClipboardImageData) => Promise<ResolvedClipboardImage>;
  onStagedAssetAdded?: (content: string, asset: StagedDocumentAsset) => void;
  onStagedAssetAbandoned?: (asset: StagedDocumentAsset) => void;
  onPasteImageError?: (error: unknown) => void;
  onLineEndingsNormalized?: (lineEnding: MarkdownLineEnding) => void;
  compact?: boolean;
  /** One-based lines to highlight when this editor is embedded in Diff. */
  diffChangedLines?: ReadonlySet<number>;
  onScrollLine?: (line: number) => void;
  onActiveLineChange?: (line: number) => void;
  onCursorPositionChange?: (position: EditorCursorPosition) => void;
  /** Stable file identity used only to restore the editor view across a generation change. */
  viewStateKey?: string;
  /** Minimum code-body line count for the automatic code-fence fold. Defaults to 10. */
  codeBlockFoldMinLines?: number;
}

export interface MarkdownEditorHandle {
  snapshot: () => EditorSnapshot | null;
  applyProposal: (base: EditorSnapshot, replacement: string) => boolean;
  focus: () => void;
  focusLine: (line: number) => void;
  scrollToLine: (line: number) => void;
  topLine: () => number;
  contains: (element: Element | null) => boolean;
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
  { action: "horizontal-rule", label: "―", title: "水平線" },
  { action: "mermaid", label: "+Mermaid", title: "Mermaid図を挿入" },
  { action: "drawio", label: "+ draw.io", title: "draw.io図を挿入" },
  { action: "svg", label: "+ SVG", title: "SVGを挿入" },
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

const setDiffChangedLines = StateEffect.define<ReadonlySet<number>>();
const diffChangedLinesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setDiffChangedLines)) continue;
      next = Decoration.set([...effect.value]
        .filter((line) => Number.isInteger(line) && line >= 1 && line <= transaction.state.doc.lines)
        .map((line) => Decoration.line({ class: "cm-diff-changed-line" }).range(transaction.state.doc.line(line).from)), true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function foldSpecialContent(view: EditorView, codeBlockFoldMinLines: number) {
  const effects = [];
  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number);
    const range = findBase64FoldRange(line.text, line.from);
    if (range) effects.push(foldEffect.of(range));
  }
  for (const range of longFencedCodeBlockRanges(view.state.sliceDoc(), codeBlockFoldMinLines)) effects.push(foldEffect.of(range));
  if (effects.length) view.dispatch({ effects });
}

function foldHeadingsBelowH1(view: EditorView) {
  const effects = [];
  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number);
    if (!/^[ \t]{0,3}#{2,6}(?:\s|$)/.test(line.text)) continue;
    const range = foldable(view.state, line.from, line.to);
    if (range) effects.push(foldEffect.of(range));
  }
  if (effects.length) view.dispatch({ effects });
}

function dispatchEdit(view: EditorView, change: MarkdownEditChange | null, userEvent: string): boolean {
  if (!change) return false;
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.anchor, head: change.head },
    scrollIntoView: true,
    userEvent,
  });
  return true;
}

function listToggleKind(action: MarkdownEditAction): StructuredListKind | null {
  if (action === "unordered-list") return "unordered";
  if (action === "ordered-list") return "ordered";
  if (action === "task-list") return "task-unchecked";
  return null;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ documentId, value, dirty, saving, onChange, onSave, onResolvePastedImage, onStagedAssetAdded, onStagedAssetAbandoned, onPasteImageError, onLineEndingsNormalized, compact = false, diffChangedLines, onScrollLine, onActiveLineChange, onCursorPositionChange, viewStateKey, codeBlockFoldMinLines = 10, onCodexConsult }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contextSelection = useRef({ from: 0, to: 0 });
  const [contextError, setContextError] = useState("");
  const viewDocumentIdRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onScrollLineRef = useRef(onScrollLine);
  const onActiveLineChangeRef = useRef(onActiveLineChange);
  const onCursorPositionChangeRef = useRef(onCursorPositionChange);
  const onResolvePastedImageRef = useRef(onResolvePastedImage);
  const onStagedAssetAddedRef = useRef(onStagedAssetAdded);
  const onStagedAssetAbandonedRef = useRef(onStagedAssetAbandoned);
  const onPasteImageErrorRef = useRef(onPasteImageError);
  const onLineEndingsNormalizedRef = useRef(onLineEndingsNormalized);
  const applyingExternal = useRef(false);
  const normalizingLists = useRef(false);
  // Viewからの追従スクロールで発生したscrollイベントを、ユーザー操作として
  // 上流へ返さないための短い抑制窓。
  const suppressScrollSyncUntilRef = useRef(0);
  const [disabledToolbarActions, setDisabledToolbarActions] = useState<MarkdownEditAction[]>([]);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onScrollLineRef.current = onScrollLine;
  onActiveLineChangeRef.current = onActiveLineChange;
  onCursorPositionChangeRef.current = onCursorPositionChange;
  onResolvePastedImageRef.current = onResolvePastedImage;
  onStagedAssetAddedRef.current = onStagedAssetAdded;
  onStagedAssetAbandonedRef.current = onStagedAssetAbandoned;
  onPasteImageErrorRef.current = onPasteImageError;
  onLineEndingsNormalizedRef.current = onLineEndingsNormalized;
  const documentLineEnding = useMemo(() => detectLineEnding(value), [documentId]);
  const normalizedDocumentValue = normalizeLineEndings(value, documentLineEnding);
  const editorValue = normalizeLineEndings(normalizedDocumentValue, "\n");
  // 世代付きdocumentIdは競合判定用であり、表示状態を共有しない。親がファイルパスの
  // viewStateKeyを渡した文書だけ、保存・再表示をまたいで表示状態を復元する。
  const stateKey = viewStateKey ?? null;

  const clampedLine = (view: EditorView, line: number) => view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.round(line))));
  useImperativeHandle(ref, () => ({
    snapshot: () => {
      const view = viewRef.current;
      if (!view || viewDocumentIdRef.current !== documentId) return null;
      const { from, to } = view.state.selection.main;
      return { documentId, content: view.state.sliceDoc(), from, to };
    },
    applyProposal: (base, replacement) => {
      const view = viewRef.current;
      if (!view || viewDocumentIdRef.current !== documentId || saving || !canApplyProposal({ documentId, content: view.state.sliceDoc(), from: 0, to: 0 }, base)) return false;
      // AIの採用を独立したUndo単位にし、通常のリスト自動整形は重ねない。
      normalizingLists.current = true;
      try {
        view.dispatch({ changes: { from: base.from, to: base.to, insert: replacement.replace(/\r\n?|\n/g, "\n") },
          annotations: isolateHistory.of("full"), userEvent: "input.ai" });
      } finally { normalizingLists.current = false; }
      view.focus();
      return true;
    },
    focus: () => viewRef.current?.focus(),
    focusLine: (line) => {
      const view = viewRef.current;
      if (!view) return;
      suppressScrollSyncUntilRef.current = performance.now() + 200;
      const target = clampedLine(view, line);
      view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
      view.focus();
    },
    scrollToLine: (line) => {
      const view = viewRef.current;
      if (!view) return;
      suppressScrollSyncUntilRef.current = performance.now() + 200;
      const target = clampedLine(view, line);
      view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: "start" }) });
    },
    topLine: () => {
      const view = viewRef.current;
      if (!view) return 1;
      return view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
    },
    contains: (element) => Boolean(element && hostRef.current?.contains(element)),
  }), [documentId, saving]);

  useEffect(() => {
    if (!hostRef.current) return;
    let cursorPositionFrame = 0;
    const reportCursorPosition = (view: EditorView) => {
      if (cursorPositionFrame) window.cancelAnimationFrame(cursorPositionFrame);
      cursorPositionFrame = window.requestAnimationFrame(() => {
        cursorPositionFrame = 0;
        const head = view.state.selection.main.head;
        const coordinates = view.coordsAtPos(head);
        const scrollBounds = view.scrollDOM.getBoundingClientRect();
        onCursorPositionChangeRef.current?.({
          line: view.state.doc.lineAt(head).number,
          screenY: coordinates?.top
            ?? scrollBounds.top + view.lineBlockAt(head).top - view.scrollDOM.scrollTop,
          remainingScroll: Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight - view.scrollDOM.scrollTop),
          viewportHeight: view.scrollDOM.clientHeight,
        });
      });
    };
    const updateToolbarContext = (view: EditorView) => {
      const source = view.state.sliceDoc();
      const cursor = view.state.selection.main.head;
      const next = TOOLBAR_ACTIONS
        .filter(({ action }) => isMarkdownToolbarActionDisabled(source, cursor, action))
        .map(({ action }) => action);
      setDisabledToolbarActions((current) => current.length === next.length && current.every((action, index) => action === next[index]) ? current : next);
    };
    const state = EditorState.create({
      doc: editorValue,
      extensions: [
        basicSetup,
        markdown({ base: markdownLanguage }),
        // CodeMirror内では改行をLFへ統一し、外部との入出力時だけ文書の
        // 推測済み改行形式へ変換する。これによりCRLF文書でも位置は1文字単位になる。
        EditorState.lineSeparator.of("\n"),
        EditorView.lineWrapping,
        base64FoldService,
        diffChangedLinesField,
        editorTheme,
        EditorView.contentAttributes.of({ "aria-label": "Markdownを編集", spellcheck: "true" }),
        Prec.high(keymap.of([
          { key: "Ctrl-.", run: (view) => dispatchEdit(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, "unordered"), "input.list.toggle") },
          { key: "Ctrl-1", run: (view) => dispatchEdit(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, "ordered"), "input.list.toggle") },
          { key: "Ctrl-[", run: (view) => dispatchEdit(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, "task-unchecked"), "input.list.toggle") },
          { key: "Ctrl-]", run: (view) => dispatchEdit(view, buildStructuredListToggle(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, "task-checked"), "input.list.toggle") },
          { key: "Shift-Enter", run: (view) => dispatchEdit(view, buildStructuredListSoftEnter(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to), "input.list.soft-enter") },
          { key: "Enter", run: (view) => dispatchEdit(view, buildStructuredListEnter(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to), "input.list.enter") },
          { key: "Tab", run: (view) => dispatchEdit(view, buildStructuredListIndent(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to), "input.list.indent") },
          { key: "Shift-Tab", run: (view) => dispatchEdit(view, buildStructuredListIndent(view.state.sliceDoc(), view.state.selection.main.from, view.state.selection.main.to, true), "input.list.outdent") },
          { key: "Alt-ArrowUp", run: (view) => dispatchEdit(view, buildStructuredListMove(view.state.sliceDoc(), view.state.selection.main.head, -1), "input.list.move") },
          { key: "Alt-ArrowDown", run: (view) => dispatchEdit(view, buildStructuredListMove(view.state.sliceDoc(), view.state.selection.main.head, 1), "input.list.move") },
          indentWithTab,
          { key: "Mod-s", run: () => { onSaveRef.current(); return true; } },
        ])),
        EditorView.domEventHandlers({
          paste: (event, view) => {
            const imageFile = clipboardImageFile(event.clipboardData);
            const resolveImage = onResolvePastedImageRef.current;
            if (imageFile && resolveImage) {
              event.preventDefault();
              const selection = view.state.selection.main;
              const originalDocument = view.state.sliceDoc();
              let stagedAsset: StagedDocumentAsset | undefined;
              void readClipboardImage(imageFile)
                .then(resolveImage)
                .then((resolved) => {
                  stagedAsset = resolved.asset;
                  const current = viewRef.current;
                  if (!current || current !== view || current.state.sliceDoc() !== originalDocument) {
                    throw new Error("画像の読込中に文書が変更されたため、貼り付けを中止しました。");
                  }
                  const markdown = clipboardImageMarkdown(resolved.source);
                  dispatchEdit(current, {
                    from: selection.from,
                    to: selection.to,
                    insert: markdown,
                    anchor: selection.from + markdown.length,
                    head: selection.from + markdown.length,
                  }, "input.image.paste");
                  if (resolved.asset) onStagedAssetAddedRef.current?.(
                    normalizeLineEndings(current.state.sliceDoc(), documentLineEnding),
                    resolved.asset,
                  );
                  if (resolved.source.toLowerCase().startsWith("data:")) foldSpecialContent(current, codeBlockFoldMinLines);
                })
                .catch((error) => {
                  if (stagedAsset) onStagedAssetAbandonedRef.current?.(stagedAsset);
                  onPasteImageErrorRef.current?.(error);
                });
              return true;
            }
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;
            const selection = view.state.selection.main;
            const normalizedText = normalizeLineEndings(text, "\n");
            const structured = buildStructuredListPaste(view.state.sliceDoc(), selection.from, selection.to, normalizedText);
            const handled = dispatchEdit(view, structured ?? {
              from: selection.from,
              to: selection.to,
              insert: normalizedText,
              anchor: selection.from + normalizedText.length,
              head: selection.from + normalizedText.length,
            }, structured ? "input.list.paste" : "input.paste");
            if (handled) event.preventDefault();
            return handled;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) updateToolbarContext(update.view);
          if (update.selectionSet || update.docChanged) {
            onActiveLineChangeRef.current?.(update.state.doc.lineAt(update.state.selection.main.head).number);
          }
          if (update.selectionSet) {
            suppressScrollSyncUntilRef.current = performance.now() + 120;
            reportCursorPosition(update.view);
          }
          if (!update.docChanged || applyingExternal.current) return;
          const editorContent = update.state.sliceDoc();
          const value = normalizeLineEndings(editorContent, documentLineEnding);
          onChangeRef.current(value);
          if (normalizingLists.current) return;
          const selection = update.state.selection.main;
          const correction = buildOrderedListNormalization(editorContent, selection.anchor, selection.head);
          if (!correction) return;
          queueMicrotask(() => {
            const current = viewRef.current;
            if (!current || current.state.sliceDoc() !== editorContent) return;
            normalizingLists.current = true;
            dispatchEdit(current, correction, "input.list.renumber");
            normalizingLists.current = false;
          });
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    viewDocumentIdRef.current = documentId;
    updateToolbarContext(view);
    if (normalizedDocumentValue !== value) {
      onChangeRef.current(normalizedDocumentValue);
      onLineEndingsNormalizedRef.current?.(documentLineEnding);
    }
    const handleEditorScroll = () => {
      if (performance.now() < suppressScrollSyncUntilRef.current) return;
      const line = view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
      onScrollLineRef.current?.(line);
    };
    view.scrollDOM.addEventListener("scroll", handleEditorScroll, { passive: true });
    onActiveLineChangeRef.current?.(view.state.doc.lineAt(view.state.selection.main.head).number);
    const rememberedState = stateKey ? restoreMarkdownEditorViewState(stateKey, view.state.sliceDoc()) : null;
    if (rememberedState) {
      view.dispatch({ selection: { anchor: rememberedState.anchor, head: rememberedState.head }, effects: rememberedState.folds.map((range) => foldEffect.of(range)) });
      suppressScrollSyncUntilRef.current = performance.now() + 200;
      window.requestAnimationFrame(() => { if (viewRef.current === view) { view.scrollDOM.scrollTop = rememberedState.scrollTop; view.scrollDOM.scrollLeft = rememberedState.scrollLeft; } });
    } else {
      foldSpecialContent(view, codeBlockFoldMinLines);
    }
    view.dispatch({ effects: setDiffChangedLines.of(diffChangedLines ?? new Set()) });
    return () => {
      if (cursorPositionFrame) window.cancelAnimationFrame(cursorPositionFrame);
      view.scrollDOM.removeEventListener("scroll", handleEditorScroll);
      const selection = view.state.selection.main;
      const folds: Array<{ from: number; to: number }> = [];
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { folds.push({ from, to }); });
      if (stateKey) rememberMarkdownEditorViewState(stateKey, { content: view.state.sliceDoc(), scrollTop: view.scrollDOM.scrollTop, scrollLeft: view.scrollDOM.scrollLeft, anchor: selection.anchor, head: selection.head, folds });
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [documentId, documentLineEnding, stateKey]);

  const diffChangedLinesKey = [...(diffChangedLines ?? [])].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setDiffChangedLines.of(diffChangedLines ?? new Set()) });
  }, [diffChangedLinesKey]);

  useEffect(() => {
    const view = viewRef.current;
    const normalizedDocument = normalizeLineEndings(value, documentLineEnding);
    const nextEditorValue = normalizeLineEndings(normalizedDocument, "\n");
    if (!view || view.state.sliceDoc() === nextEditorValue) return;
    applyingExternal.current = true;
    const currentValue = view.state.sliceDoc();
    const change = minimalTextChange(currentValue, nextEditorValue);
    if (!change) return;
    const selection = view.state.selection.main;
    const scrollTop = view.scrollDOM.scrollTop;
    const scrollLeft = view.scrollDOM.scrollLeft;
    view.dispatch({ changes: change, selection: {
      anchor: mapTextPosition(selection.anchor, change), head: mapTextPosition(selection.head, change),
    } });
    suppressScrollSyncUntilRef.current = performance.now() + 200;
    window.requestAnimationFrame(() => { if (viewRef.current === view) { view.scrollDOM.scrollTop = scrollTop; view.scrollDOM.scrollLeft = scrollLeft; } });
    applyingExternal.current = false;
    if (normalizedDocument !== value) {
      onChangeRef.current(normalizedDocument);
      onLineEndingsNormalizedRef.current?.(documentLineEnding);
    }
  }, [value, documentLineEnding]);

  const apply = (action: MarkdownEditAction) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const kind = listToggleKind(action);
    const change = kind
      ? buildStructuredListToggle(view.state.sliceDoc(), selection.from, selection.to, kind)
      : buildContextualMarkdownEdit(view.state.sliceDoc(), selection.from, selection.to, action, selection.head);
    dispatchEdit(view, change, "input.toolbar");
    view.focus();
  };

  const editContext = async (target: CodexTarget, action: "copy" | "cut" | "paste") => {
    const view = viewRef.current;
    if (!view || target.documentId !== documentId || view.state.sliceDoc() !== target.content) return;
    const range = contextSelection.current;
    try {
      setContextError("");
      if (action === "paste") {
        const text = await navigator.clipboard.readText();
        if (viewRef.current !== view || view.state.sliceDoc() !== target.content) return;
        view.dispatch({ changes: { ...range, insert: text.replace(/\r\n?/g, "\n") }, selection: { anchor: range.from + text.replace(/\r\n?/g, "\n").length }, userEvent: "input.paste", scrollIntoView: true });
      } else {
        await navigator.clipboard.writeText(target.content.slice(range.from, range.to));
        if (action === "cut" && viewRef.current === view && view.state.sliceDoc() === target.content) view.dispatch({ changes: { ...range, insert: "" }, selection: { anchor: range.from }, userEvent: "delete.cut" });
      }
      view.focus();
    } catch { setContextError("クリップボードを操作できません。Ctrl+C／Ctrl+X／Ctrl+Vを使用してください。"); }
  };
  const consultation = useConsultationMenu(value, documentId, onCodexConsult, (event) => {
    const view = viewRef.current;
    if (!view || saving) return null;
    const selected = view.state.selection.main;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? selected.head;
    const range = !selected.empty && pos >= selected.from && pos <= selected.to ? selected : view.state.doc.lineAt(pos);
    contextSelection.current = range === selected ? { from: selected.from, to: selected.to } : { from: pos, to: pos };
    return { documentId, content: view.state.sliceDoc(), from: range.from, to: range.to };
  }, [
    { label: "元に戻す", group: "history", disabled: saving, run: () => { if (viewRef.current) { undo(viewRef.current); viewRef.current.focus(); } } },
    { label: "やり直す", group: "history", disabled: saving, run: () => { if (viewRef.current) { redo(viewRef.current); viewRef.current.focus(); } } },
    { label: "切り取り", group: "clipboard", disabled: saving, run: target => editContext(target, "cut") },
    { label: "コピー", group: "clipboard", run: target => editContext(target, "copy") },
    { label: "貼り付け", group: "clipboard", disabled: saving, run: target => editContext(target, "paste") },
    { label: "すべて選択", group: "selection", run: () => { if (viewRef.current) { selectAll(viewRef.current); viewRef.current.focus(); } } },
  ]);
  return <section className={`markdown-editor${compact ? " markdown-editor--compact" : ""}`} aria-label="Markdown編集">
    <div className="markdown-editor__toolbar" role="toolbar" aria-label="Markdown書式">
      {TOOLBAR_ACTIONS.map((item) => <button key={item.action} type="button" title={item.title} aria-label={item.title} disabled={disabledToolbarActions.includes(item.action)} onClick={() => apply(item.action)}>{item.label}</button>)}
      <span className="markdown-editor__toolbar-spacer" />
      <button type="button" title="H2以下と長いコードを折畳" onClick={() => { const view = viewRef.current; if (view) { foldHeadingsBelowH1(view); foldSpecialContent(view, codeBlockFoldMinLines); } }}>折畳</button>
      <button type="button" title="すべて展開" onClick={() => { const view = viewRef.current; if (view) unfoldAll(view); }}>展開</button>
      <button type="button" className="markdown-editor__save" disabled={!dirty || saving} onClick={onSave}>{saving ? "保存中…" : "保存"}</button>
    </div>
    <div className="markdown-editor__surface" ref={hostRef} onContextMenuCapture={consultation.onContextMenuCapture} />
    {consultation.menu}
    {contextError && <p role="alert">{contextError}</p>}
  </section>;
});
