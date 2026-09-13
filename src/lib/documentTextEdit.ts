import type { EditorSnapshot } from "../features/codex/model";

/** 表示モードに依存せず、確認した本文の指定範囲だけを置き換える。 */
export function replaceDocumentText(current: EditorSnapshot, base: EditorSnapshot, replacement: string): string | null {
  if (current.documentId !== base.documentId || current.content !== base.content || !Number.isInteger(base.from) || !Number.isInteger(base.to) || base.from < 0 || base.to < base.from || base.to > base.content.length) return null;
  const newline = current.content.includes("\r\n") ? "\r\n" : current.content.includes("\r") ? "\r" : "\n";
  return current.content.slice(0, base.from) + replacement.replace(/\r\n?|\n/g, newline) + current.content.slice(base.to);
}

export class PreviewEditHistory {
  private changes = new Map<string, { undo: Array<{ before: string; after: string }>; redo: Array<{ before: string; after: string }> }>();
  record(id: string, before: string, after: string) {
    if (before === after) return;
    let history = this.changes.get(id);
    if (!history || (history.undo.length && history.undo[history.undo.length - 1].after !== before)) history = { undo: [], redo: [] };
    history.undo.push({ before, after }); history.undo = history.undo.slice(-100); history.redo = [];
    this.changes.delete(id); this.changes.set(id, history);
    if (this.changes.size > 32) this.changes.delete(this.changes.keys().next().value!);
  }
  restore(id: string, content: string, redo = false): string | null {
    const history = this.changes.get(id);
    const entries = redo ? history?.redo : history?.undo;
    const entry = entries?.[entries.length - 1];
    if (!history || !entry || content !== (redo ? entry.before : entry.after)) return null;
    (redo ? history.redo : history.undo).pop();
    (redo ? history.undo : history.redo).push(entry);
    return redo ? entry.after : entry.before;
  }
}
