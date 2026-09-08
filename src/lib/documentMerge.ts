/** 行単位の比較・採用。表示用の空間は本文に挿入しない。 */
export interface MergeCell { line: number; text: string }
export interface MergeRow {
  id: string;
  base?: string;
  storage?: MergeCell;
  local?: MergeCell;
  result?: MergeCell;
  externalChanged: boolean;
  changed: boolean;
  fingerprint: string;
}
export type MergeChoice = "storage" | "local" | "manual";
export interface MergeDecision { choice: MergeChoice; fingerprint: string; result?: string }
export type MergeDecisions = Record<string, MergeDecision>;
export const mergeLines = (content: string) => content.replace(/\r\n?/g, "\n").split("\n");

/** 共通の前後を除いたMyers。計算上限では精度を落とした一括置換を返さず停止する。 */
function lineOperations<T>(base: T[], target: string[], matches: (left: T, right: string) => boolean): ("equal" | "add" | "delete")[] {
  let prefix = 0;
  while (prefix < base.length && prefix < target.length && matches(base[prefix], target[prefix])) prefix++;
  let suffix = 0;
  while (suffix < base.length - prefix && suffix < target.length - prefix
    && matches(base[base.length - suffix - 1], target[target.length - suffix - 1])) suffix++;
  const a = base.slice(prefix, base.length - suffix), b = target.slice(prefix, target.length - suffix);
  const trace: Map<number, number>[] = [];
  const frontier = new Map<number, number>([[1, 0]]);
  let work = 0;
  for (let depth = 0; depth <= a.length + b.length; depth++) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      if (++work > 250_000) throw new Error("差分が多すぎるため行対応を安全に確定できません。変更範囲を小さくして再比較してください。");
      let x = diagonal === -depth || (diagonal !== depth && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < a.length && y < b.length && matches(a[x], b[y])) { x++; y++; }
      frontier.set(diagonal, x);
      if (x < a.length || y < b.length) continue;
      const reverse: ("equal" | "add" | "delete")[] = [];
      x = a.length; y = b.length;
      for (let d = trace.length - 1; d >= 0; d--) {
        const previous = trace[d], k = x - y;
        const previousK = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK;
        while (x > previousX && y > previousY) { reverse.push("equal"); x--; y--; }
        if (d === 0) break;
        if (x === previousX) { reverse.push("add"); y--; }
        else { reverse.push("delete"); x--; }
      }
      return [...Array<"equal">(prefix).fill("equal"), ...reverse.reverse(), ...Array<"equal">(suffix).fill("equal")];
    }
  }
  return [];
}

function slots<T>(base: T[], content: string, matches: (left: T, right: string) => boolean) {
  const lines = mergeLines(content);
  const operations = lineOperations(base, lines, matches);
  const cells = new Map<number, MergeCell>();
  const insertions = new Map<number, MergeCell[]>();
  let baseIndex = 0, targetIndex = 0, index = 0;
  while (index < operations.length) {
    if (operations[index] === "equal") {
      cells.set(baseIndex++, { line: targetIndex + 1, text: lines[targetIndex++] }); index++; continue;
    }
    const start = baseIndex;
    const added: MergeCell[] = [];
    while (index < operations.length && operations[index] !== "equal") {
      if (operations[index++] === "delete") baseIndex++;
      else added.push({ line: targetIndex + 1, text: lines[targetIndex++] });
    }
    const paired = Math.min(baseIndex - start, added.length);
    for (let i = 0; i < paired; i++) cells.set(start + i, added[i]);
    if (added.length > paired) insertions.set(baseIndex, added.slice(paired));
  }
  return { cells, insertions };
}

export function buildMergeRows(baseContent: string, storageContent: string, localContent: string, resultContent: string): MergeRow[] {
  const base = mergeLines(baseContent);
  const equal = (left: string, right: string) => left === right;
  const storage = slots(base, storageContent, equal), local = slots(base, localContent, equal);
  const rows: MergeRow[] = [];
  const add = (id: string, original: string | undefined, s?: MergeCell, l?: MergeCell, r?: MergeCell) => {
    rows.push({ id, base: original, storage: s, local: l, result: r,
      externalChanged: s?.text !== original,
      changed: s?.text !== original || l?.text !== original,
      fingerprint: JSON.stringify([id, original, s?.text, l?.text]) });
  };
  for (let i = 0; i <= base.length; i++) {
    const s = storage.insertions.get(i) ?? [], l = local.insertions.get(i) ?? [];
    for (let offset = 0; offset < Math.max(s.length, l.length); offset++) add(`add:${i}:${offset}`, undefined, s[offset], l[offset]);
    if (i < base.length) add(`base:${i}`, base[i], storage.cells.get(i), local.cells.get(i));
  }
  if (resultContent === localContent || resultContent === storageContent) {
    const side = resultContent === localContent ? "local" : "storage";
    return rows.map((row) => withResult(row, row[side]));
  }
  // 結果は採用元2列の対応へ揃える。基準だけと再比較すると採用した挿入行が置換行へ移る。
  const result = slots(rows, resultContent, (row, text) => row.storage?.text === text || row.local?.text === text || row.base === text);
  const aligned: MergeRow[] = [];
  for (let i = 0; i <= rows.length; i++) {
    for (const [offset, cell] of (result.insertions.get(i) ?? []).entries()) aligned.push({
      id: `result:${i}:${offset}`, result: cell, externalChanged: false, changed: true,
      fingerprint: JSON.stringify([`result:${i}:${offset}`, null, null, null]),
    });
    if (i < rows.length) aligned.push({ ...rows[i], result: result.cells.get(i), changed: rows[i].changed || result.cells.get(i)?.text !== rows[i].base });
  }
  return aligned;
}

function withResult(row: MergeRow, result?: MergeCell): MergeRow {
  if (row.result?.text === result?.text && row.result?.line === result?.line) return row;
  return { ...row, result, changed: row.storage?.text !== row.base || row.local?.text !== row.base || result?.text !== row.base };
}

/** 採用後も対応行を固定する。本文だけから毎回推測すると同文の反復行が別の位置へ移る。 */
export function adoptMergeResult(content: string, rows: readonly MergeRow[], id: string, side: "storage" | "local") {
  const nextContent = adoptMergeRow(content, rows, id, side);
  let line = 0;
  const aligned = rows.map((row) => {
    const cell = row.id === id ? row[side] : row.result;
    return withResult(row, cell ? { text: cell.text, line: ++line } : undefined);
  });
  // 空の文書にもCodeMirrorの1行が存在する。
  if (!line) {
    const blank = aligned.findIndex((row) => row[side]?.text === "");
    if (blank >= 0) aligned[blank] = withResult(aligned[blank], { text: "", line: 1 });
    else aligned.push(manualRowFactory(aligned)({ text: "", line: 1 }));
  }
  return { content: nextContent, rows: aligned };
}

function manualRowFactory(rows: readonly MergeRow[]) {
  const ids = new Set(rows.map((row) => row.id));
  let sequence = rows.length;
  return (cell: MergeCell): MergeRow => {
    while (ids.has(`manual:${sequence}`)) sequence++;
    const id = `manual:${sequence++}`; ids.add(id);
    return { id, result: cell, changed: true, externalChanged: false, fingerprint: JSON.stringify([id, null, null, null]) };
  };
}

/** 手入力は直前の結果行へ対応付け、既存の採用元と空行の位置を維持する。 */
export function editMergeResult(content: string, rows: readonly MergeRow[], nextContent: string): MergeRow[] {
  const edits = slots(mergeLines(content), nextContent, (left, right) => left === right);
  const aligned: MergeRow[] = [];
  const manualRow = manualRowFactory(rows);
  for (const row of rows) {
    if (!row.result) { aligned.push(row); continue; }
    const index = row.result.line - 1;
    for (const cell of edits.insertions.get(index) ?? []) aligned.push(manualRow(cell));
    aligned.push(withResult(row, edits.cells.get(index)));
  }
  for (const cell of edits.insertions.get(mergeLines(content).length) ?? []) aligned.push(manualRow(cell));
  return aligned;
}

export function adoptMergeRow(content: string, rows: readonly MergeRow[], id: string, side: "storage" | "local"): string {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) throw new Error("採用対象の行が変わりました。最新の差分を確認してください。");
  const row = rows[index], cell = row[side];
  const lines = mergeLines(content);
  // 現在の結果行、なければ次の実在行の手前へ挿入する。行番号は保存直前にも再計算する。
  const insertion = row.result ? row.result.line - 1 : (rows.slice(index + 1).find((next) => next.result)?.result?.line ?? lines.length + 1) - 1;
  lines.splice(insertion, row.result ? 1 : 0, ...(cell ? [cell.text] : []));
  const separator = content.includes("\r\n") ? "\r\n" : content.includes("\r") ? "\r" : "\n";
  return lines.join(separator);
}

export function rowDecision(row: MergeRow, decisions: MergeDecisions): MergeChoice | "same" | "unresolved" {
  const decision = decisions[row.id];
  if (decision?.fingerprint === row.fingerprint && decision.result === row.result?.text) return decision.choice;
  if (row.storage?.text === row.local?.text && row.result?.text === row.storage?.text) return "same";
  return row.externalChanged ? "unresolved" : "local";
}

export function unresolvedMergeRows(rows: readonly MergeRow[], decisions: MergeDecisions): number {
  return rows.filter((row) => row.externalChanged && rowDecision(row, decisions) === "unresolved").length;
}
