import { lazy, Suspense, useMemo } from "react";
import { applyStorageHunk, buildDocumentDiff, changedLineNumbers, documentDiffHunks } from "../lib/documentDiff";
import type { EditorWorkspaceMode } from "../state/tabsReducer";
import { MarkdownPreview } from "./MarkdownPreview";
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
  label: string;
  content: string;
  changedLines: ReadonlySet<number>;
  display: "code" | "rendered";
}

function filename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
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
        { key: "opened-rendered", label: "起動時レンダリング", content: target.openedContent, changedLines: changes.base, display: "rendered" },
        { key: "opened-code", label: "起動時コード", content: target.openedContent, changedLines: changes.base, display: "code" },
        { key: "editing-code", label: "現在のコード", content: target.editingContent, changedLines: changes.target, display: "code" },
        { key: "editing-rendered", label: "現在のレンダリング", content: target.editingContent, changedLines: changes.target, display: "rendered" },
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
        { ...model.versions[0], key: `opened-${display}`, label: "ストレージ／起動時", display },
        { ...model.versions[1], key: `editing-${display}`, label: "現在", display },
      ],
    };
  }

  const versions = Object.fromEntries(model.versions.map((version) => [version.id, version]));
  return {
    mode: "three-way",
    summary: "3-way（ストレージに外部変更あり）",
    panes: [
      { ...versions.storage, key: `storage-${display}`, label: "ストレージ", display },
      { ...versions.opened, key: `opened-${display}`, label: "起動時", display },
      { ...versions.editing, key: `editing-${display}`, label: "現在", display },
    ],
  };
}

function CodePane({ pane, target, onEditingChange, onSave }: {
  pane: DiffPane;
  target: DocumentDiffTarget;
  onEditingChange?: (content: string) => void;
  onSave?: () => void;
}) {
  if (pane.key.startsWith("editing-") && onEditingChange) {
    return <Suspense fallback={<div className="markdown-editor-loading">エディターを読み込んでいます…</div>}><MarkdownEditor
      documentId={`diff:${target.path}`}
      value={pane.content}
      dirty
      saving={false}
      onChange={onEditingChange}
      onSave={() => onSave?.()}
      compact
    /></Suspense>;
  }
  return <ol className="document-diff__code">
    {pane.content.replace(/\r\n?/g, "\n").split("\n").map((line, index) => (
      <li key={index} className={pane.changedLines.has(index + 1) ? "is-changed" : undefined}>
        <code>{line || " "}</code>
      </li>
    ))}
  </ol>;
}

function RenderedPane({ pane, target, theme }: { pane: DiffPane; target: DocumentDiffTarget; theme: string }) {
  return <div className="document-diff__rendered">
    <MarkdownPreview
      content={pane.content}
      baseDir={target.baseDir}
      imageVersions={{}}
      theme={theme}
      mermaidMode="always-code"
      diffChangedLines={pane.changedLines}
      staticMode
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
  return <section className="document-diff-workspace" aria-label={`${filename(target.path)}の差分`}>
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
      {workspace.panes.map((pane) => <article className="document-diff__pane" key={pane.key}>
        <header>{pane.label}<small>{pane.changedLines.size}変更行</small></header>
        {pane.display === "code" ? <CodePane pane={pane} target={target} onEditingChange={onEditingChange} onSave={onSave} /> : <RenderedPane pane={pane} target={target} theme={theme} />}
      </article>)}
    </div>
  </section>;
}
