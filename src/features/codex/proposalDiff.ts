export interface ProposalDiffLine {
  kind: "removed" | "added" | "unchanged";
  text: string;
}

/** 採用確認で前後の1行を対応付ける。undefined は追加または削除された行を表す。 */
export interface ProposalReviewRow {
  id: string;
  original?: string;
  proposal?: string;
  originalIndex?: number;
  proposalIndex?: number;
  changed: boolean;
}

const normalizeLines = (value: string) => value.replace(/\r\n?/g, "\n").split("\n");

/**
 * 行単位採用用の安定した対応表を作る。大きすぎる表では計算を止めず、同じ行番号で対応させる。
 * 行の採用は常に現在の proposal 文字列から再計算するため、手編集後も古い位置を適用しない。
 */
export function buildProposalRows(original: string, proposal: string): ProposalReviewRow[] {
  const before = normalizeLines(original), after = normalizeLines(proposal);
  if (before.length * after.length > 250_000) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({
      id: `line:${index}`, original: before[index], proposal: after[index],
      originalIndex: index < before.length ? index : undefined,
      proposalIndex: index < after.length ? index : undefined,
      changed: before[index] !== after[index],
    }));
  }
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left--) for (let right = after.length - 1; right >= 0; right--) {
    table[left][right] = before[left] === after[right]
      ? table[left + 1][right + 1] + 1 : Math.max(table[left + 1][right], table[left][right + 1]);
  }
  const rows: ProposalReviewRow[] = [];
  let left = 0, right = 0, sequence = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      rows.push({ id: `same:${sequence++}`, original: before[left], proposal: after[right], originalIndex: left++, proposalIndex: right++, changed: false });
    } else if (right < after.length && (left === before.length || table[left][right + 1] >= table[left + 1][right])) {
      rows.push({ id: `add:${sequence++}`, proposal: after[right], proposalIndex: right++, changed: true });
    } else {
      rows.push({ id: `remove:${sequence++}`, original: before[left], originalIndex: left++, changed: true });
    }
  }
  // 連続する追加・削除は置換として同じ高さへそろえる。これで「変更前を採用」が
  // 追加行を消すだけではなく、元の行へ戻る。
  const paired: ProposalReviewRow[] = [];
  for (let index = 0; index < rows.length;) {
    if (!rows[index].changed) { paired.push(rows[index++]); continue; }
    const chunk: ProposalReviewRow[] = [];
    while (index < rows.length && rows[index].changed) chunk.push(rows[index++]);
    const removed = chunk.filter(row => row.originalIndex !== undefined);
    const added = chunk.filter(row => row.proposalIndex !== undefined);
    for (let n = 0; n < Math.max(removed.length, added.length); n++) {
      paired.push({ id: `change:${removed[n]?.id ?? ""}:${added[n]?.id ?? ""}`, original: removed[n]?.original,
        proposal: added[n]?.proposal, originalIndex: removed[n]?.originalIndex, proposalIndex: added[n]?.proposalIndex, changed: true });
    }
  }
  return paired;
}

/** 指定行を変更前または変更後として採用する。改行種別は現在の変更案を維持する。 */
export function adoptProposalRow(value: string, rows: readonly ProposalReviewRow[], id: string, side: "original" | "proposal"): string {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error("採用対象の行が変わりました。最新の差分を確認してください。");
  const lines = normalizeLines(value);
  const separator = value.includes("\r\n") ? "\r\n" : value.includes("\r") ? "\r" : "\n";
  const target = side === "original" ? row.original : row.proposal;
  const index = row.proposalIndex ?? Math.min(row.originalIndex ?? lines.length, lines.length);
  if (row.proposalIndex === undefined) {
    if (target !== undefined) lines.splice(index, 0, target);
  } else if (target === undefined) {
    lines.splice(index, 1);
  } else {
    lines[index] = target;
  }
  return lines.join(separator);
}

export const restoreProposalOriginal = (original: string) => original;

export interface ProposalStableRow { id: string; original?: string; proposal?: string; current?: string }
export interface ProposalStableState { rows: ProposalStableRow[]; separator: string; sequence: number }
export function createProposalStableState(original: string, proposal: string): ProposalStableState {
  const rows = buildProposalRows(original, proposal).map((row, index) => ({ id: `proposal:${index}`, original: row.original, proposal: row.proposal, current: row.proposal }));
  return { rows, separator: proposal.includes("\r\n") ? "\r\n" : "\n", sequence: rows.length };
}
export const proposalStableValue = (state: ProposalStableState) => state.rows.flatMap((row) => row.current === undefined ? [] : [row.current]).join(state.separator);
/** 手編集後は現行行とのdiffで既存IDを移し、追加行だけ新IDにする。 */
export function editProposalStableState(state: ProposalStableState, next: string): ProposalStableState {
  const current = proposalStableValue(state), rows = buildProposalRows(current, next), old = state.rows.filter((row) => row.current !== undefined); let sequence = state.sequence;
  const nextRows: ProposalStableRow[] = rows.map((row) => {
    const prior = row.originalIndex === undefined ? undefined : old[row.originalIndex];
    return prior ? { ...prior, current: row.proposal } : { id: `proposal:${sequence++}`, proposal: row.proposal, current: row.proposal };
  });
  // 非表示の行を末尾へ追いやらず、直後の既存IDの前に残す。
  for (let index = 0; index < state.rows.length; index++) {
    const row = state.rows[index];
    if (nextRows.some(candidate => candidate.id === row.id)) continue;
    const following = state.rows.slice(index + 1).find(candidate => nextRows.some(nextRow => nextRow.id === candidate.id));
    const insertion = following ? nextRows.findIndex(candidate => candidate.id === following.id) : nextRows.length;
    nextRows.splice(insertion, 0, { ...row, current: undefined });
  }
  return { ...state, rows: nextRows, sequence };
}
export function adoptProposalStableRow(state: ProposalStableState, id: string, side: "original" | "proposal"): ProposalStableState {
  return { ...state, rows: state.rows.map((row) => row.id === id ? { ...row, current: side === "original" ? row.original : row.proposal } : row) };
}

/**
 * 文章提案を採用前に確認するための、意図的に単純な独自表示モデル。
 * 行の対応付けや外部diff実装を用いず、現在の対象と提案内容をそのまま提示する。
 */
export function buildProposalDiff(original: string, proposal: string): ProposalDiffLine[] {
  if (original === proposal) return [{ kind: "unchanged", text: "変更はありません。" }];
  return [
    ...displayLines(original).map((text) => ({ kind: "removed" as const, text })),
    ...displayLines(proposal).map((text) => ({ kind: "added" as const, text })),
  ];
}

function displayLines(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (normalized.length === 0) return ["（空の本文）"];
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines[lines.length - 1] = "↵";
  return lines.length > 0 ? lines : ["（空の本文）"];
}
