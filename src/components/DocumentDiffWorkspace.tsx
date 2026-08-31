import { Fragment, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import type { EditorWorkspaceMode } from "../state/tabsReducer";
import type { DocumentDiffTarget } from "../lib/documentDiffTarget";
import { rowDecision } from "../lib/documentMerge";
import { useDocumentMerge } from "../hooks/useDocumentMerge";
import { DiffCodeEditor, DIFF_LINE_HEIGHT, type DiffColumn } from "./DiffCodeEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import "../styles/document-diff.css";
export type { DocumentDiffTarget } from "../lib/documentDiffTarget";

export interface DiffSaveReview {
  path: string; content: string; baselineRevision?: string; storageRevision?: string;
  unresolved: number; blocked: boolean; hasExternalChanges: boolean;
}
export function buildWorkspaceDiffPanes(target: DocumentDiffTarget, editorMode: EditorWorkspaceMode, localContent = target.editingContent) {
  const threeWay = target.openedContent !== target.storageContent;
  const panes: { key: DiffColumn; label: string; content: string }[] = [
    { key: "storage", label: threeWay ? "ストレージ最新版" : "ストレージ／保存済み", content: target.storageContent },
    { key: "result", label: "採用結果・編集中", content: target.editingContent },
  ];
  if (threeWay) panes.push({ key: "local", label: "自分の変更（3-way開始時）", content: localContent });
  return { mode: threeWay ? "three-way" as const : "two-way" as const,
    summary: threeWay ? "3-way（ストレージに外部変更あり）" : "2-way（ストレージと保存済みは同一）",
    panes, showPreview: editorMode !== "edit" };
}

export function DocumentDiffWorkspace({ target, editorMode, theme, onEditingChange, onSave, onReviewChange, onRefresh, saving = false }: {
  target: DocumentDiffTarget; editorMode: EditorWorkspaceMode; theme: string;
  onEditingChange?: (content: string) => void; onSave?: () => void;
  onReviewChange?: (review: DiffSaveReview | null) => void; onRefresh?: () => void; saving?: boolean;
}) {
  const merge = useDocumentMerge(target, onEditingChange);
  const workspace = buildWorkspaceDiffPanes(target, editorMode, merge.local);
  const root = useRef<HTMLElement>(null);
  const [activeRow, setActiveRow] = useState<string>();
  const scrollTop = useRef(0);
  const blocked = Boolean(target.refreshing || target.storageError || merge.error);
  useLayoutEffect(() => {
    onReviewChange?.({ path: target.path, content: target.editingContent, baselineRevision: target.baselineRevision,
      storageRevision: target.storageRevision, unresolved: merge.unresolved, blocked,
      hasExternalChanges: target.openedContent !== target.storageContent });
  }, [onReviewChange, target.path, target.editingContent, target.baselineRevision, target.storageRevision, target.openedContent, target.storageContent, merge.unresolved, blocked]);
  useLayoutEffect(() => () => onReviewChange?.(null), [onReviewChange]);
  const synchronize = (event: UIEvent<HTMLElement>) => {
    const source = event.target as HTMLElement;
    if (!source.matches(".diff-code-editor .cm-scroller, .diff-row-actions")) return;
    scrollTop.current = source.scrollTop;
    root.current?.querySelectorAll<HTMLElement>(".diff-code-editor .cm-scroller, .diff-row-actions").forEach((other) => {
      if (other !== source && Math.abs(other.scrollTop - source.scrollTop) > .5) other.scrollTop = source.scrollTop;
      if (other !== source && other.matches(".cm-scroller") && source.matches(".cm-scroller")) other.scrollLeft = source.scrollLeft;
    });
  };
  useLayoutEffect(() => {
    const scrollers = [...(root.current?.querySelectorAll<HTMLElement>(".diff-columns .cm-scroller, .diff-row-actions") ?? [])];
    const position = Math.max(0, Math.min(scrollTop.current, ...scrollers.map((element) => Math.max(0, element.scrollHeight - element.clientHeight))));
    scrollers.forEach((element) => { element.scrollTop = position; });
    scrollTop.current = position;
  }, [merge.rows.length, workspace.mode]);
  const actions = (side: "storage" | "local") => <div className="diff-row-actions" aria-label={`${side === "storage" ? "ストレージ" : "自分"}側の行採用`}>
    <div className="diff-row-actions__content" style={{ height: merge.rows.length * DIFF_LINE_HEIGHT }}>
      {merge.rows.map((row, index) => {
        if (!row.changed || (row.storage?.text === row.local?.text && row.result?.text === row.storage?.text)) return null;
        const decision = rowDecision(row, merge.decisions);
        const state = decision === "unresolved" ? "未選択" : decision === "storage" ? "ストレージ側" : decision === "local" ? "自分側" : decision === "manual" ? "手動編集" : "一致";
        const label = `${side === "storage" ? "ストレージ" : "自分"}側の${row[side] ? `${row[side]!.line}行目` : "削除"}を採用（対応行${index + 1}・${state}）`;
        return <button key={row.id} type="button" data-row-id={row.id} data-choice={side} data-status={decision}
          style={{ top: index * DIFF_LINE_HEIGHT }} title={label} aria-label={label} aria-pressed={decision === side}
          disabled={saving || blocked || !onEditingChange} onFocus={() => setActiveRow(row.id)} onMouseEnter={() => setActiveRow(row.id)}
          onClick={() => merge.adopt(row.id, side, row.fingerprint)}>
          <span>{side === "storage" ? "→" : "←"}</span><small>{decision === side ? "✓" : decision === "manual" ? "M" : decision === "unresolved" ? "?" : ""}</small>
        </button>;
      })}
    </div>
  </div>;
  const name = target.path.split(/[\\/]/).pop() ?? target.path;
  return <section ref={root} className="document-diff-workspace" aria-label={`${name}の差分`} onScrollCapture={synchronize}
    onKeyDownCapture={(event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
        event.preventDefault(); event.stopPropagation();
        if (onEditingChange && !saving) (event.shiftKey || event.key.toLowerCase() === "y" ? merge.redo : merge.undo)();
      }
    }}>
    <header className="document-diff-workspace__header">
      <strong>{name}の差分</strong><small>{workspace.summary}</small>
      <span role="status">未選択 {merge.unresolved}行</span>
      <button type="button" onClick={merge.undo} disabled={!onEditingChange || !merge.canUndo || saving}>元に戻す</button>
      <button type="button" onClick={merge.redo} disabled={!onEditingChange || !merge.canRedo || saving}>やり直す</button>
      {onRefresh && <button type="button" onClick={onRefresh} disabled={target.refreshing}>最新版を再確認</button>}
      {onSave && <button type="button" onClick={onSave} disabled={blocked || saving || merge.unresolved > 0}>{saving ? "保存中…" : "採用結果を保存"}</button>}
    </header>
    <p className="diff-help">矢印は同じ高さの行だけを採用します。✓ 採用済み / ? 未選択 / M 手動編集。採用だけでは保存しません。コードは全列同じ書式・折り返しなしです。</p>
    {target.refreshing && <p role="status">ストレージ最新版を確認中…</p>}
    {(target.storageError || merge.error) && <p role="alert">{target.storageError ?? merge.error}（本文は保持しています。確認できるまで採用・保存はできません）</p>}
    <div className={`diff-columns diff-columns--${workspace.mode}`}>
      {workspace.panes.map((pane, index) => <Fragment key={pane.key}>
        {index > 0 && <div className="diff-action-column"><div className="diff-action-heading" aria-hidden="true">採用</div>{actions(index === 1 ? "storage" : "local")}</div>}
        <article className="document-diff__pane" data-pane-key={pane.key}>
          <header>{pane.label}</header>
          <DiffCodeEditor value={pane.content} label={pane.label} column={pane.key} rows={merge.rows}
            readOnly={pane.key !== "result" || !onEditingChange} activeRow={activeRow} onActivate={setActiveRow}
            onChange={merge.edit} onSave={onSave} onUndo={merge.undo} onRedo={merge.redo} />
        </article>
      </Fragment>)}
    </div>
    <details className="diff-baseline"><summary>比較基準（最後に正常に読込／保存した内容）</summary><pre>{target.openedContent}</pre></details>
    {workspace.showPreview && <details className="diff-previews"><summary>レンダリングを確認</summary><div className="diff-previews__columns">
      {workspace.panes.map((pane) => <article key={pane.key}><strong>{pane.label}</strong><MarkdownPreview content={pane.content} baseDir={target.baseDir}
        imageVersions={{}} theme={theme} mermaidMode="always-code" staticMode /></article>)}
    </div></details>}
  </section>;
}
