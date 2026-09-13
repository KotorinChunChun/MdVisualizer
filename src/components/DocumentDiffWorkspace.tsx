import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type UIEvent } from "react";
import type { EditorWorkspaceMode } from "../state/tabsReducer";
import type { DocumentDiffTarget } from "../lib/documentDiffTarget";
import { rowDecision } from "../lib/documentMerge";
import { useDocumentMerge } from "../hooks/useDocumentMerge";
import { DiffCodeEditor, type DiffColumn } from "./DiffCodeEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import "../styles/document-diff.css";
export type { DocumentDiffTarget } from "../lib/documentDiffTarget";

export interface DiffSaveReview {
  path: string; content: string; baselineRevision?: string; storageRevision?: string;
  unresolved: number; blocked: boolean; hasExternalChanges: boolean;
}
export function buildWorkspaceDiffPanes(target: DocumentDiffTarget, editorMode: EditorWorkspaceMode) {
  const threeWay = target.openedContent !== target.storageContent;
  const panes: { key: DiffColumn; label: string; content: string }[] = threeWay
    ? [
      { key: "base", label: "比較基準（読込／保存時）", content: target.openedContent },
      { key: "storage", label: "ストレージ最新版", content: target.storageContent },
      { key: "result", label: "採用結果・編集中", content: target.editingContent },
    ]
    : [
      { key: "storage", label: "ストレージ／保存済み", content: target.storageContent },
      { key: "result", label: "採用結果・編集中", content: target.editingContent },
    ];
  return { mode: threeWay ? "three-way" as const : "two-way" as const,
    summary: threeWay ? "3-way（ストレージに外部変更あり）" : "2-way（ストレージと保存済みは同一）",
    panes, showCode: editorMode !== "preview", showPreview: editorMode === "split" || editorMode === "preview" };
}

export function DocumentDiffWorkspace({ target, editorMode, theme, onEditingChange, onSave, onReviewChange, onRefresh, saving = false }: {
  target: DocumentDiffTarget; editorMode: EditorWorkspaceMode; theme: string;
  onEditingChange?: (content: string) => void; onSave?: () => void;
  onReviewChange?: (review: DiffSaveReview | null) => void; onRefresh?: () => void; saving?: boolean;
}) {
  const merge = useDocumentMerge(target, onEditingChange);
  const workspace = buildWorkspaceDiffPanes(target, editorMode);
  const root = useRef<HTMLElement>(null);
  const [activeRow, setActiveRow] = useState<string>();
  const [verticalRatio, setVerticalRatio] = useState(.5);
  const [twoWayRatio, setTwoWayRatio] = useState(.5);
  const [threeWayRatios, setThreeWayRatios] = useState<[number, number, number]>([1 / 3, 1 / 3, 1 / 3]);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const scrollTop = useRef(0);
  const blocked = Boolean(target.refreshing || target.storageError || merge.error);
  useLayoutEffect(() => {
    onReviewChange?.({ path: target.path, content: target.editingContent, baselineRevision: target.baselineRevision,
      storageRevision: target.storageRevision, unresolved: merge.unresolved, blocked,
      hasExternalChanges: target.openedContent !== target.storageContent });
  }, [onReviewChange, target.path, target.editingContent, target.baselineRevision, target.storageRevision, target.openedContent, target.storageContent, merge.unresolved, blocked]);
  useLayoutEffect(() => () => onReviewChange?.(null), [onReviewChange]);
  useEffect(() => () => resizeCleanup.current?.(), []);
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
  const actions = () => <div className="diff-row-actions" aria-label="行採用">
    <div className="diff-row-actions__content">
      {merge.rows.map((row, index) => {
        if (!row.changed || (row.storage?.text === row.local?.text && row.result?.text === row.storage?.text)) return <div key={row.id} className="diff-row-actions__row" />;
        const decision = rowDecision(row, merge.decisions);
        const state = decision === "unresolved" ? "未選択" : decision === "storage" ? "ストレージ側" : decision === "local" ? "自分側" : decision === "manual" ? "手動編集" : "一致";
        return <div key={row.id} className="diff-row-actions__row">{(["storage", "local"] as const).map((side) => {
          const label = `${side === "storage" ? "ストレージ" : "自分"}側の${row[side] ? `${row[side]!.line}行目` : "削除"}を採用（対応行${index + 1}・${state}）`;
          return <button key={side} type="button" data-row-id={row.id} data-choice={side} data-status={decision}
            title={label} aria-label={label} aria-pressed={decision === side} disabled={saving || blocked || !onEditingChange}
            onFocus={() => setActiveRow(row.id)} onMouseEnter={() => setActiveRow(row.id)} onClick={() => merge.adopt(row.id, side, row.fingerprint)}>
            <span>{side === "storage" ? "→" : "←"}</span><small>{decision === side ? "✓" : decision === "manual" ? "M" : decision === "unresolved" ? "?" : ""}</small>
          </button>;
        })}</div>;
      })}
    </div>
  </div>;
  const changeResize = (kind: "vertical" | "two-way" | "three-way-left" | "three-way-right", delta: number) => {
    if (kind === "vertical") {
      setVerticalRatio((value) => Math.max(.2, Math.min(.8, value + delta)));
    } else if (kind === "two-way") {
      setTwoWayRatio((value) => Math.max(.18, Math.min(.82, value + delta)));
    } else {
      const index = kind === "three-way-left" ? 0 : 1;
      setThreeWayRatios((values) => {
        const pair = values[index] + values[index + 1];
        const first = Math.max(.12, Math.min(pair - .12, values[index] + delta));
        const next = [...values] as [number, number, number]; next[index] = first; next[index + 1] = pair - first; return next;
      });
    }
  };
  const resize = (kind: "vertical" | "two-way" | "three-way-left" | "three-way-right") => (event: PointerEvent<HTMLElement>) => {
    const element = event.currentTarget, bounds = root.current?.getBoundingClientRect();
    if (!bounds) return;
    resizeCleanup.current?.(); event.preventDefault(); element.setPointerCapture(event.pointerId);
    const initialX = event.clientX, initialY = event.clientY, initialVertical = verticalRatio, initialTwo = twoWayRatio, initialThree = threeWayRatios;
    const move = (next: globalThis.PointerEvent) => {
      if (kind === "vertical") {
        setVerticalRatio(Math.max(.2, Math.min(.8, initialVertical + (next.clientY - initialY) / Math.max(1, bounds.height))));
      } else if (kind === "two-way") {
        setTwoWayRatio(Math.max(.18, Math.min(.82, initialTwo + (next.clientX - initialX) / Math.max(1, bounds.width - 40))));
      } else {
        const index = kind === "three-way-left" ? 0 : 1, pair = initialThree[index] + initialThree[index + 1];
        const first = Math.max(.12, Math.min(pair - .12, initialThree[index] + (next.clientX - initialX) / Math.max(1, bounds.width - 46)));
        const nextRatios = [...initialThree] as [number, number, number]; nextRatios[index] = first; nextRatios[index + 1] = pair - first; setThreeWayRatios(nextRatios);
      }
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); resizeCleanup.current = null; };
    resizeCleanup.current = end;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };
  const resizeKey = (kind: "vertical" | "two-way" | "three-way-left" | "three-way-right") => (event: KeyboardEvent<HTMLElement>) => {
    const horizontal = kind !== "vertical", decrease = horizontal ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increase = horizontal ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault(); changeResize(kind, (increase ? 1 : -1) * (event.shiftKey ? .1 : .05));
  };
  const template = workspace.mode === "two-way"
    ? `minmax(160px, ${twoWayRatio}fr) 40px minmax(160px, ${1 - twoWayRatio}fr)`
    : `minmax(160px, ${threeWayRatios[0]}fr) 6px minmax(160px, ${threeWayRatios[1]}fr) 40px minmax(160px, ${threeWayRatios[2]}fr)`;
  const previewTemplate = workspace.showCode ? template : template.split("160px").join("70px");
  const changedLines = (column: DiffColumn) => new Set(merge.rows.filter((row) => row.changed).flatMap((row) => {
    if (column === "base") { const match = /^base:(\d+)$/.exec(row.id); return match && row.base !== undefined ? [Number(match[1]) + 1] : []; }
    return row[column]?.line ? [row[column]!.line] : [];
  }));
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
    {workspace.showCode && <div className={`diff-columns diff-columns--${workspace.mode}`} style={{ flex: workspace.showPreview ? `0 1 ${verticalRatio * 100}%` : "1 1 0", gridTemplateColumns: template } as CSSProperties}>
      {workspace.mode === "three-way" && <article className="document-diff__pane" data-pane-key="base"><header>比較基準（読込／保存時）</header><DiffCodeEditor value={target.openedContent} label="比較基準" column="base" rows={merge.rows} readOnly activeRow={activeRow} onActivate={setActiveRow} /></article>}
      {workspace.mode === "three-way" && <div className="diff-resize-handle" role="separator" tabIndex={0} aria-label="比較基準とストレージの幅を変更" aria-orientation="vertical" onPointerDown={resize("three-way-left")} onKeyDown={resizeKey("three-way-left")} />}
      <article className="document-diff__pane" data-pane-key="storage"><header>{workspace.mode === "three-way" ? "ストレージ最新版" : "ストレージ／保存済み"}</header><DiffCodeEditor value={target.storageContent} label="ストレージ" column="storage" rows={merge.rows} readOnly activeRow={activeRow} onActivate={setActiveRow} /></article>
      <div className="diff-action-column"><div className="diff-action-heading" aria-hidden="true">採用</div>{actions()}<div className="diff-resize-handle diff-resize-handle--action" role="separator" tabIndex={0} aria-label="比較列の幅を変更" aria-orientation="vertical" onPointerDown={resize(workspace.mode === "two-way" ? "two-way" : "three-way-right")} onKeyDown={resizeKey(workspace.mode === "two-way" ? "two-way" : "three-way-right")} /></div>
      <article className="document-diff__pane" data-pane-key="result"><header>採用結果・編集中</header><DiffCodeEditor value={target.editingContent} label="採用結果・編集中" column="result" rows={merge.rows} readOnly={!onEditingChange} activeRow={activeRow} onActivate={setActiveRow} onChange={merge.edit} onSave={onSave} onUndo={merge.undo} onRedo={merge.redo} /></article>
    </div>}
    {workspace.showPreview && workspace.showCode && <div className="diff-resize-handle diff-resize-handle--horizontal" role="separator" tabIndex={0} aria-label="コードとプレビューの高さを変更" aria-orientation="horizontal" onPointerDown={resize("vertical")} onKeyDown={resizeKey("vertical")} />}
    {workspace.showPreview && <div className={`diff-previews${workspace.showCode ? "" : " diff-previews--only"}`} style={workspace.showCode ? { flex: `0 1 ${(1 - verticalRatio) * 100}%` } : undefined}><div className={`diff-previews__columns diff-previews__columns--${workspace.mode}`} style={{ gridTemplateColumns: previewTemplate } as CSSProperties}>
      {workspace.mode === "three-way" && <><article><header>比較基準（読込／保存時）</header><div className="diff-preview__content"><MarkdownPreview content={target.openedContent} baseDir={target.baseDir} imageVersions={{}} theme={theme} renderSvgFences diffChangedLines={changedLines("base")} /></div></article><div className="diff-preview-resize" role="separator" tabIndex={0} aria-label="比較基準とストレージの幅を変更" aria-orientation="vertical" onPointerDown={resize("three-way-left")} onKeyDown={resizeKey("three-way-left")} /></>}
      <article><header>{workspace.mode === "three-way" ? "ストレージ最新版" : "ストレージ／保存済み"}</header><div className="diff-preview__content"><MarkdownPreview content={target.storageContent} baseDir={target.baseDir} imageVersions={{}} theme={theme} renderSvgFences diffChangedLines={changedLines("storage")} /></div></article>
      <div className="diff-preview-resize diff-preview-resize--action" role="separator" tabIndex={0} aria-label="比較列の幅を変更" aria-orientation="vertical" onPointerDown={resize(workspace.mode === "two-way" ? "two-way" : "three-way-right")} onKeyDown={resizeKey(workspace.mode === "two-way" ? "two-way" : "three-way-right")} />
      <article><header>採用結果・編集中</header><div className="diff-preview__content"><MarkdownPreview content={target.editingContent} baseDir={target.baseDir} imageVersions={{}} theme={theme} renderSvgFences diffChangedLines={changedLines("result")} /></div></article>
    </div></div>}
  </section>;
}
