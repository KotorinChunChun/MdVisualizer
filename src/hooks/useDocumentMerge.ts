import { useMemo, useRef, useState } from "react";
import { adoptMergeResult, editMergeResult, buildMergeRows, unresolvedMergeRows, type MergeDecisions, type MergeRow } from "../lib/documentMerge";
import type { DocumentDiffTarget } from "../lib/documentDiffTarget";

interface Snapshot { content: string; decisions: MergeDecisions; rows?: MergeRow[]; sourceKey?: string }
interface Session {
  base: string; baselineRevision?: string; local: string; threeWay: boolean;
  present: Snapshot; past: Snapshot[]; future: Snapshot[];
}
const initial = (target: DocumentDiffTarget): Session => ({ base: target.openedContent, baselineRevision: target.baselineRevision,
  local: target.editingContent, threeWay: target.openedContent !== target.storageContent,
  present: { content: target.editingContent, decisions: {} }, past: [], future: [] });

/** 編集と採用を同じ履歴に積む。採用元を保持し、外部更新後はfingerprint不一致の判断を無効にする。 */
export function useDocumentMerge(target: DocumentDiffTarget, onChange?: (content: string) => void) {
  const [stored, setStored] = useState(() => initial(target));
  let session = stored;
  if (stored.base !== target.openedContent || stored.baselineRevision !== target.baselineRevision) session = initial(target);
  else if (!stored.threeWay && target.openedContent !== target.storageContent) session = { ...stored, local: target.editingContent, threeWay: true };
  else if (stored.threeWay && target.openedContent === target.storageContent) session = { ...stored, local: target.editingContent, threeWay: false };
  else if (stored.present.content !== target.editingContent) session = { ...stored, present: { content: target.editingContent, decisions: {} }, past: [], future: [] };
  if (session !== stored) setStored(session);
  const current = useRef(session);
  current.current = session;
  const local = session.threeWay ? session.local : target.editingContent;
  // 2wayでも履歴内の採用元が不必要に変わらないよう、表示用localは結果から独立させる。
  const alignmentLocal = session.local;
  const sourceKey = JSON.stringify([target.openedContent, target.storageContent, alignmentLocal]);
  const { rows, error } = useMemo(() => {
    try { return { rows: session.present.sourceKey === sourceKey && session.present.rows ? session.present.rows
      : buildMergeRows(target.openedContent, target.storageContent, alignmentLocal, session.present.content), error: null }; }
    catch (reason) { return { rows: [] as MergeRow[], error: String(reason) }; }
  }, [target.openedContent, target.storageContent, alignmentLocal, sourceKey, session.present]);
  const context = useRef({ target, rows, error, sourceKey, onChange });
  context.current = { target, rows, error, sourceKey, onChange };
  const set = (next: Session) => { current.current = next; setStored(next); context.current.onChange?.(next.present.content); };
  const commit = (present: Snapshot) => {
    const previous = current.current;
    set({ ...previous, present, past: [...previous.past.slice(-199), previous.present], future: [] });
  };
  const edit = (content: string) => {
    const previous = current.current;
    if (content === previous.present.content) return;
    const decisions = { ...previous.present.decisions };
    const ctx = context.current;
    let nextRows: MergeRow[] | undefined;
    try {
      nextRows = editMergeResult(previous.present.content, ctx.rows, content);
      const old = new Map(ctx.rows.map((row) => [row.id, row]));
      for (const row of nextRows) if (row.result?.text !== old.get(row.id)?.result?.text) decisions[row.id] = {
        choice: "manual", fingerprint: row.fingerprint, result: row.result?.text,
      };
    } catch { /* 計算不能なら採用・保存を無効にしたまま本文編集を保持する。 */ }
    commit({ content, decisions, rows: nextRows, sourceKey: ctx.sourceKey });
  };
  const adopt = (id: string, side: "storage" | "local", expectedFingerprint: string) => {
    const ctx = context.current;
    if (ctx.error || ctx.target.refreshing || ctx.target.storageError || !ctx.onChange) return;
    const row = ctx.rows.find((candidate) => candidate.id === id);
    if (!row || row.fingerprint !== expectedFingerprint) return;
    const result = adoptMergeResult(current.current.present.content, ctx.rows, id, side);
    commit({ ...result, sourceKey: ctx.sourceKey, decisions: { ...current.current.present.decisions,
      [id]: { choice: side, fingerprint: row.fingerprint, result: row[side]?.text } } });
  };
  const undo = () => {
    const previous = current.current, present = previous.past[previous.past.length - 1];
    if (present) set({ ...previous, present, past: previous.past.slice(0, -1), future: [previous.present, ...previous.future] });
  };
  const redo = () => {
    const previous = current.current, present = previous.future[0];
    if (present) set({ ...previous, present, past: [...previous.past, previous.present], future: previous.future.slice(1) });
  };
  return { rows, error, local,
    decisions: session.present.decisions, unresolved: unresolvedMergeRows(rows, session.present.decisions),
    edit, adopt, undo, redo, canUndo: session.past.length > 0, canRedo: session.future.length > 0 };
}
