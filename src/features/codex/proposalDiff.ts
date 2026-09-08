export interface ProposalDiffLine {
  kind: "removed" | "added" | "unchanged";
  text: string;
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
