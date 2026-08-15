import { useMemo } from "react";
import { buildDocumentDiff, changedLineNumbers } from "../lib/documentDiff";
import type { EditorWorkspaceMode } from "../state/tabsReducer";
import { MarkdownPreview } from "./MarkdownPreview";
import "../styles/document-diff.css";

export interface DocumentDiffTarget {
  path: string;
  baseDir: string;
  openedContent: string;
  storageContent: string;
  editingContent: string;
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

function CodePane({ pane }: { pane: DiffPane }) {
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

export function DocumentDiffWorkspace({ target, editorMode, theme }: {
  target: DocumentDiffTarget;
  editorMode: EditorWorkspaceMode;
  theme: string;
}) {
  const workspace = useMemo(() => buildWorkspaceDiffPanes(target, editorMode), [editorMode, target]);
  return <section className="document-diff-workspace" aria-label={`${filename(target.path)}の差分`}>
    <header className="document-diff-workspace__header">
      <strong>{filename(target.path)}の差分</strong>
      <small>{workspace.summary}</small>
    </header>
    <div className={`document-diff__panes document-diff__panes--${workspace.mode}`}>
      {workspace.panes.map((pane) => <article className="document-diff__pane" key={pane.key}>
        <header>{pane.label}<small>{pane.changedLines.size}変更行</small></header>
        {pane.display === "code" ? <CodePane pane={pane} /> : <RenderedPane pane={pane} target={target} theme={theme} />}
      </article>)}
    </div>
  </section>;
}
