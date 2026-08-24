import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, type Ref, type UIEvent } from "react";
import { applyStorageHunk, buildDocumentDiff, changedLineNumbers, documentDiffHunks, mapLineBetweenDocuments, type DocumentDiffVersionId } from "../lib/documentDiff";
import { sourceBlockIndexForLine, sourceLineAtViewportTop, sourceTopForLine, type EditorCursorPosition } from "../lib/paneSync";
import type { EditorWorkspaceMode } from "../state/tabsReducer";
import { MarkdownPreview } from "./MarkdownPreview";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import "../styles/document-diff.css";

const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

export interface DocumentDiffTarget {
  path: string;
  baseDir: string;
  openedContent: string;
  storageContent: string;
  editingContent: string;
  storageRevision?: string;
  conflict?: boolean;
}

interface DiffPane {
  key: string;
  version: DocumentDiffVersionId;
  label: string;
  content: string;
  changedLines: ReadonlySet<number>;
  display: "code" | "rendered";
}

function filename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

interface ScrollMetric {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Maps one DIFF pane's relative vertical position to another pane. */
export function synchronizedDiffScrollTop(source: ScrollMetric, target: ScrollMetric): number {
  const sourceMaximum = Math.max(0, source.scrollHeight - source.clientHeight);
  const targetMaximum = Math.max(0, target.scrollHeight - target.clientHeight);
  if (sourceMaximum === 0 || targetMaximum === 0) return 0;
  const ratio = Math.max(0, Math.min(1, source.scrollTop / sourceMaximum));
  return ratio * targetMaximum;
}

export function buildWorkspaceDiffPanes(target: DocumentDiffTarget, editorMode: EditorWorkspaceMode): {
  mode: "two-way" | "three-way" | "four-way";
  summary: string;
  panes: DiffPane[];
} {
  if (editorMode === "split") {
    const changes = changedLineNumbers(target.openedContent, target.editingContent);
    return {
      mode: "four-way",
      summary: "2-way（起動時と現在）",
      panes: [
        { key: "opened-rendered", version: "opened", label: "起動時レンダリング", content: target.openedContent, changedLines: changes.base, display: "rendered" },
        { key: "opened-code", version: "opened", label: "起動時コード", content: target.openedContent, changedLines: changes.base, display: "code" },
        { key: "editing-code", version: "editing", label: "現在のコード", content: target.editingContent, changedLines: changes.target, display: "code" },
        { key: "editing-rendered", version: "editing", label: "現在のレンダリング", content: target.editingContent, changedLines: changes.target, display: "rendered" },
      ],
    };
  }

  const model = buildDocumentDiff(target.openedContent, target.storageContent, target.editingContent);
  const display = editorMode === "edit" ? "code" : "rendered";
  if (model.mode === "two-way") {
    return {
      mode: "two-way",
      summary: "2-way（ストレージと起動時は同一）",
      panes: [
        { ...model.versions[0], version: model.versions[0].id, key: `opened-${display}`, label: "ストレージ／起動時", display },
        { ...model.versions[1], version: model.versions[1].id, key: `editing-${display}`, label: "現在", display },
      ],
    };
  }

  const versions = Object.fromEntries(model.versions.map((version) => [version.id, version]));
  return {
    mode: "three-way",
    summary: "3-way（ストレージに外部変更あり）",
    panes: [
      { ...versions.storage, version: "storage", key: `storage-${display}`, label: "ストレージ", display },
      { ...versions.opened, version: "opened", key: `opened-${display}`, label: "起動時", display },
      { ...versions.editing, version: "editing", key: `editing-${display}`, label: "現在", display },
    ],
  };
}

function CodePane({ pane, target, onEditingChange, onSave, editorRef, currentLine, onActiveLineChange, onCursorPositionChange, onScrollLine, onActivateLine }: {
  pane: DiffPane;
  target: DocumentDiffTarget;
  onEditingChange?: (content: string) => void;
  onSave?: () => void;
  editorRef?: Ref<MarkdownEditorHandle>;
  currentLine?: number;
  onActiveLineChange?: (line: number) => void;
  onCursorPositionChange?: (position: EditorCursorPosition) => void;
  onScrollLine?: (line: number) => void;
  onActivateLine?: (pane: DiffPane, line: number) => void;
}) {
  if (pane.key.startsWith("editing-") && onEditingChange) {
    return <Suspense fallback={<div className="markdown-editor-loading">エディターを読み込んでいます…</div>}><MarkdownEditor
      ref={editorRef}
      documentId={`diff:${target.path}`}
      value={pane.content}
      dirty
      saving={false}
      onChange={onEditingChange}
      onSave={() => onSave?.()}
      compact
      onActiveLineChange={onActiveLineChange}
      onCursorPositionChange={onCursorPositionChange}
      onScrollLine={onScrollLine}
    /></Suspense>;
  }
  return <ol className="document-diff__code" onClick={(event) => {
    const line = Number((event.target as Element | null)?.closest<HTMLElement>("li[data-source-line]")?.dataset.sourceLine);
    if (Number.isFinite(line) && line > 0) onActivateLine?.(pane, line);
  }}>
    {pane.content.replace(/\r\n?/g, "\n").split("\n").map((line, index) => (
      <li key={index} data-source-line={index + 1} className={[pane.changedLines.has(index + 1) ? "is-changed" : "", currentLine === index + 1 ? "is-current" : ""].filter(Boolean).join(" ") || undefined}>
        <code>{line || " "}</code>
      </li>
    ))}
  </ol>;
}

function RenderedPane({ pane, target, theme, currentLine, onActivateLine }: { pane: DiffPane; target: DocumentDiffTarget; theme: string; currentLine?: number; onActivateLine?: (pane: DiffPane, line: number) => void }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = contentRef.current;
    root?.querySelectorAll(".is-editor-current-line").forEach((element) => element.classList.remove("is-editor-current-line"));
    if (!root || currentLine === undefined) return;
    const blocks = [...root.querySelectorAll<HTMLElement>("[data-source-line]")];
    const index = sourceBlockIndexForLine(blocks.map((block) => Number(block.dataset.sourceLine)), currentLine);
    const selected = blocks[index];
    selected?.classList.add("is-editor-current-line");
    return () => selected?.classList.remove("is-editor-current-line");
  }, [currentLine, pane.content]);
  return <div className="document-diff__rendered" onClick={(event) => {
    const line = Number((event.target as Element | null)?.closest<HTMLElement>("[data-source-line]")?.dataset.sourceLine);
    if (Number.isFinite(line) && line > 0) onActivateLine?.(pane, line);
  }}>
    <MarkdownPreview
      content={pane.content}
      baseDir={target.baseDir}
      imageVersions={{}}
      theme={theme}
      mermaidMode="always-code"
      diffChangedLines={pane.changedLines}
      staticMode
      contentRef={contentRef}
    />
  </div>;
}

export function DocumentDiffWorkspace({ target, editorMode, theme, onEditingChange, onSave, onOverwrite }: {
  target: DocumentDiffTarget;
  editorMode: EditorWorkspaceMode;
  theme: string;
  onEditingChange?: (content: string) => void;
  onSave?: () => void;
  onOverwrite?: () => void;
}) {
  const workspace = useMemo(() => buildWorkspaceDiffPanes(target, editorMode), [editorMode, target]);
  const storageHunks = useMemo(() => documentDiffHunks(target.openedContent, target.storageContent), [target.openedContent, target.storageContent]);
  const workspaceRef = useRef<HTMLElement>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const pendingEditorLine = useRef<number | null>(null);
  const [activeEditingLine, setActiveEditingLine] = useState(1);
  const programmedScrolls = useRef(new WeakMap<HTMLElement, number>());

  const lineFromEditing = useCallback((pane: DiffPane, line: number) => pane.version === "editing"
    ? line
    : mapLineBetweenDocuments(target.editingContent, pane.content, line), [target.editingContent]);
  const lineToEditing = useCallback((pane: DiffPane, line: number) => pane.version === "editing"
    ? line
    : mapLineBetweenDocuments(pane.content, target.editingContent, line), [target.editingContent]);

  const sourceMetrics = useCallback((element: HTMLElement) => {
    const seen = new Set<number>();
    return [...element.querySelectorAll<HTMLElement>("[data-source-line]")].flatMap((block) => {
      const line = Number(block.dataset.sourceLine);
      if (!Number.isFinite(line) || line < 1 || seen.has(line) || block.getClientRects().length === 0) return [];
      seen.add(line);
      return [{ line, top: block.getBoundingClientRect().top }];
    });
  }, []);
  const setProgrammedScroll = useCallback((element: HTMLElement, next: number) => {
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    const clamped = Math.max(0, Math.min(maximum, next));
    programmedScrolls.current.set(element, clamped);
    element.scrollTop = clamped;
  }, []);
  const alignOtherPanes = useCallback((editingLine: number, desiredScreenY: number, except?: HTMLElement) => {
    const articles = workspaceRef.current?.querySelectorAll<HTMLElement>(".document-diff__pane[data-pane-key]") ?? [];
    articles.forEach((article) => {
      const pane = workspace.panes.find((candidate) => candidate.key === article.dataset.paneKey);
      const element = article.querySelector<HTMLElement>(".document-diff__code, .document-diff__rendered");
      if (!pane || !element || element === except) return;
      const targetTop = sourceTopForLine(sourceMetrics(element), lineFromEditing(pane, editingLine));
      if (targetTop === null) return;
      setProgrammedScroll(element, element.scrollTop + targetTop - desiredScreenY);
    });
  }, [lineFromEditing, setProgrammedScroll, sourceMetrics, workspace.panes]);
  const handleDiffCursorPosition = useCallback((position: EditorCursorPosition) => {
    setActiveEditingLine(position.line);
    window.requestAnimationFrame(() => alignOtherPanes(position.line, position.screenY));
  }, [alignOtherPanes]);
  const handleDiffEditorScroll = useCallback((line: number) => {
    const editorScroller = workspaceRef.current?.querySelector<HTMLElement>(".cm-scroller");
    if (!editorScroller) return;
    alignOtherPanes(line, editorScroller.getBoundingClientRect().top);
  }, [alignOtherPanes]);
  const activatePaneLine = useCallback((pane: DiffPane, line: number) => {
    const editingLine = lineToEditing(pane, line);
    setActiveEditingLine(editingLine);
    if (editorRef.current) editorRef.current.focusLine(editingLine);
    else pendingEditorLine.current = editingLine;
  }, [lineToEditing]);
  const setEditorHandle = useCallback((handle: MarkdownEditorHandle | null) => {
    editorRef.current = handle;
    if (!handle || pendingEditorLine.current === null) return;
    const line = pendingEditorLine.current;
    pendingEditorLine.current = null;
    handle.focusLine(line);
  }, []);

  const synchronizeScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const source = event.target instanceof HTMLElement ? event.target : null;
    if (!source?.matches(".document-diff__code, .document-diff__rendered, .cm-scroller")) return;
    const expected = programmedScrolls.current.get(source);
    if (expected !== undefined) {
      programmedScrolls.current.delete(source);
      if (Math.abs(source.scrollTop - expected) < 1) return;
    }
    if (source.matches(".cm-scroller") && editorMode !== "preview") return;
    if (editorMode !== "preview") {
      const article = source.closest<HTMLElement>(".document-diff__pane[data-pane-key]");
      const pane = workspace.panes.find((candidate) => candidate.key === article?.dataset.paneKey);
      if (!pane) return;
      const sourceBounds = source.getBoundingClientRect();
      const line = sourceLineAtViewportTop(sourceMetrics(source), sourceBounds.top);
      const editingLine = lineToEditing(pane, line);
      editorRef.current?.scrollToLine(editingLine);
      alignOtherPanes(editingLine, sourceBounds.top, source);
      return;
    }
    const scrollElements = workspaceRef.current?.querySelectorAll<HTMLElement>(
      ".document-diff__code, .document-diff__rendered, .cm-scroller",
    ) ?? [];
    scrollElements.forEach((element) => {
      if (element === source) return;
      element.scrollTop = synchronizedDiffScrollTop(source, element);
      programmedScrolls.current.set(element, element.scrollTop);
    });
  }, [alignOtherPanes, editorMode, lineToEditing, sourceMetrics, workspace.panes]);
  return <section ref={workspaceRef} className="document-diff-workspace" aria-label={`${filename(target.path)}の差分`} onScrollCapture={synchronizeScroll}>
    <header className="document-diff-workspace__header">
      <strong>{filename(target.path)}の差分</strong>
      <span className="document-diff-workspace__summary">
        <small>{target.conflict ? `保存競合・${workspace.summary}` : workspace.summary}</small>
        {target.conflict && onOverwrite && <button type="button" className="document-diff-workspace__overwrite" onClick={onOverwrite}>確認した内容で上書き保存</button>}
      </span>
    </header>
    {storageHunks.length > 0 && <div className="document-diff__hunk-actions" aria-label="ストレージ変更の採用">
      <strong>ストレージ最新版から採用</strong>
      {storageHunks.map((hunk, index) => <button
        type="button"
        key={hunk.id}
        onClick={() => onEditingChange?.(applyStorageHunk(target.openedContent, target.editingContent, hunk))}
        disabled={!onEditingChange}
      >{index + 1}: {hunk.kind === "add" ? "行追加" : hunk.kind === "delete" ? "行削除" : "行変更"}を採用</button>)}
    </div>}
    <div className={`document-diff__panes document-diff__panes--${workspace.mode}`}>
      {workspace.panes.map((pane) => <article className="document-diff__pane" data-pane-key={pane.key} data-version={pane.version} key={pane.key}>
        <header>{pane.label}<small>{pane.changedLines.size}変更行</small></header>
        {pane.display === "code" ? <CodePane
          pane={pane}
          target={target}
          onEditingChange={onEditingChange}
          onSave={onSave}
          editorRef={pane.version === "editing" ? setEditorHandle : undefined}
          currentLine={editorMode === "preview" ? undefined : lineFromEditing(pane, activeEditingLine)}
          onActiveLineChange={pane.version === "editing" ? setActiveEditingLine : undefined}
          onCursorPositionChange={pane.version === "editing" ? handleDiffCursorPosition : undefined}
          onScrollLine={pane.version === "editing" ? handleDiffEditorScroll : undefined}
          onActivateLine={activatePaneLine}
        /> : <RenderedPane pane={pane} target={target} theme={theme} currentLine={editorMode === "preview" ? undefined : lineFromEditing(pane, activeEditingLine)} onActivateLine={editorMode === "preview" ? undefined : activatePaneLine} />}
      </article>)}
    </div>
  </section>;
}
