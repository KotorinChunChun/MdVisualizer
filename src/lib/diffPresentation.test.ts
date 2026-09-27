import { describe, expect, it } from "vitest";
import { changedRanges, diffPresentation } from "./diffPresentation";
import { buildMergeRows } from "./documentMerge";

describe("赤緑の差分表示", () => {
  it("共通部分を残して複数の変更箇所だけ強調する", () => {
    expect(changedRanges("abcXdefYghi", "abcZdefWghi")).toEqual({ old: [{ from: 3, to: 4 }, { from: 7, to: 8 }], next: [{ from: 3, to: 4 }, { from: 7, to: 8 }] });
  });
  it("日本語・絵文字のUTF-16境界を壊さない", () => {
    expect(changedRanges("前😀後", "前😎後")).toEqual({ old: [{ from: 1, to: 3 }], next: [{ from: 1, to: 3 }] });
  });
  it("挿入・削除・空行を扱う", () => {
    expect(changedRanges("ab", "a追加b")).toEqual({ old: [], next: [{ from: 1, to: 3 }] });
    expect(changedRanges("削除", "")).toEqual({ old: [{ from: 0, to: 2 }], next: [] });
    expect(changedRanges("", "")).toEqual({ old: [], next: [] });
  });
  it("長大な埋め込み行は上限付きで共通前後を保持する", () => {
    const a = "data:" + "a".repeat(100_000) + ":end", b = "data:" + "b".repeat(100_000) + ":end";
    expect(changedRanges(a, b)).toEqual({ old: [{ from: 5, to: 100_005 }], next: [{ from: 5, to: 100_005 }] });
  });
  it("2-wayは保存済みを赤・編集中を緑にする", () => {
    const row = buildMergeRows("旧", "旧", "新", "新")[0];
    expect(diffPresentation(row, "storage", false).kind).toBe("deleted");
    expect(diffPresentation(row, "result", false).kind).toBe("added");
    expect(diffPresentation(row, "result", false)).toBe(diffPresentation(row, "result", false));
  });
  it("3-wayは開始時に対し両方の新しい本文を比較する", () => {
    const row = buildMergeRows("abc", "aSc", "abL", "abL")[0];
    expect(diffPresentation(row, "base", true)).toEqual({ kind: "deleted", ranges: [{ from: 1, to: 3 }] });
    expect(diffPresentation(row, "storage", true)).toEqual({ kind: "added", ranges: [{ from: 1, to: 2 }] });
    expect(diffPresentation(row, "result", true)).toEqual({ kind: "added", ranges: [{ from: 2, to: 3 }] });
  });
  it("未変更側は他方に差分があっても着色しない", () => {
    const row = buildMergeRows("元", "外部", "元", "元")[0];
    expect(diffPresentation(row, "result", true)).toEqual({ kind: "equal", ranges: [] });
  });
  it("行追加・行削除は存在する側だけを着色する", () => {
    for (const [old, next] of [["a\nb", "a\nX\nb"], ["a\nX\nb", "a\nb"]]) {
      const rows = buildMergeRows(old, old, next, next);
      const row = rows.find(row => row.storage?.text === "X" || row.result?.text === "X")!;
      expect(diffPresentation(row, "storage", false).kind).toBe(row.storage ? "deleted" : "equal");
      expect(diffPresentation(row, "result", false).kind).toBe(row.result ? "added" : "equal");
    }
  });
});
