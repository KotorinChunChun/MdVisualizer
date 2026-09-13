import { describe, expect, it } from "vitest";
import { canApplyProposal, normalizeCodexOptions, requestBytes } from "./model";
import { buildProposalDiff } from "./proposalDiff";
describe("Codexの設定と変更案", () => {
  const base = { documentId: "a:1", content: "前\n文章\n後", from: 2, to: 4 };
  it("既定は無効かつLunaで、明示的な同意だけを有効として扱う", () => {
    expect(normalizeCodexOptions(null)).toEqual({ enabled: false, model: "gpt-5.6-luna", tool: "codex-cli" });
    expect(normalizeCodexOptions({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeCodexOptions({ enabled: true }).enabled).toBe(true);
    expect(normalizeCodexOptions({ enabled: true, tool: "claude-cli" }).enabled).toBe(false);
  });
  it("カーソル移動は許容し、別文書・世代・本文変更・不正範囲は拒否", () => {
    expect(canApplyProposal({ ...base, from: 0, to: 0 }, base)).toBe(true);
    expect(canApplyProposal({ ...base, documentId: "a:2" }, base)).toBe(false);
    expect(canApplyProposal({ ...base, content: "変更済み" }, base)).toBe(false);
    expect(canApplyProposal(base, { ...base, from: -1 })).toBe(false);
    expect(canApplyProposal(base, { ...base, to: 500 })).toBe(false);
    expect(canApplyProposal(null, base)).toBe(false);
  });
  it("送信量は日本語のUTF-8と履歴を含める", () => {
    expect(requestBytes("あ", "い", [{ role: "user", text: "う" }])).toBe(9);
  });
  it("独自の提案表示は現在の対象と提案を明示する", () => {
    expect(buildProposalDiff("文\n", "")).toEqual([
      { text: "文", kind: "removed" }, { text: "↵", kind: "removed" }, { text: "（空の本文）", kind: "added" },
    ]);
    expect(buildProposalDiff("同じ", "同じ")).toEqual([{ text: "変更はありません。", kind: "unchanged" }]);
  });
});
