import { describe, expect, it } from "vitest";
import { applyStorageHunk, buildDocumentDiff, changedLineNumbers, documentDiffHunks } from "./documentDiff";

describe("document diff", () => {
  it("reports one-based changed lines on both sides", () => {
    const result = changedLineNumbers("one\ntwo\nthree", "one\nchanged\nthree\nfour");
    expect([...result.base]).toEqual([2]);
    expect([...result.target]).toEqual([2, 4]);
  });

  it("uses two-way mode while storage still matches the opened content", () => {
    const model = buildDocumentDiff("# A\nold", "# A\nold", "# A\nnew");
    expect(model.mode).toBe("two-way");
    expect(model.versions.map((version) => version.id)).toEqual(["opened", "editing"]);
    expect([...model.versions[1].changedLines]).toEqual([2]);
  });

  it("uses three-way mode when storage changed independently", () => {
    const model = buildDocumentDiff("# A\nbase", "# A\nstorage", "# A\nediting");
    expect(model.mode).toBe("three-way");
    expect(model.versions.map((version) => version.id)).toEqual(["opened", "storage", "editing"]);
    expect(model.versions.map((version) => [...version.changedLines])).toEqual([[2], [2], [2]]);
  });

  it("groups consecutive storage additions, changes, and deletions into hunks", () => {
    const hunks = documentDiffHunks("a\nb\nc\nd\ne", "a\nB\nC\nd\nf");
    expect(hunks.map((hunk) => ({ kind: hunk.kind, base: [hunk.baseStart, hunk.baseEnd], target: hunk.targetLines }))).toEqual([
      { kind: "change", base: [1, 3], target: ["B", "C"] },
      { kind: "change", base: [4, 5], target: ["f"] },
    ]);
  });

  it("applies a storage hunk over the corresponding independently edited region", () => {
    const [storageHunk] = documentDiffHunks("a\nb\nc", "a\nstorage\nc");
    expect(applyStorageHunk("a\nb\nc", "mine\na\nediting\nc", storageHunk)).toBe("mine\na\nstorage\nc");
  });

  it("applies additions and deletions while preserving CRLF and the final newline", () => {
    const add = documentDiffHunks("a\r\nb\r\n", "a\r\nnew\r\nb\r\n")[0];
    const added = applyStorageHunk("a\r\nb\r\n", "a\r\nb\r\n", add);
    expect(added).toBe("a\r\nnew\r\nb\r\n");
    const remove = documentDiffHunks("a\r\nnew\r\nb\r\n", "a\r\nb\r\n")[0];
    expect(applyStorageHunk("a\r\nnew\r\nb\r\n", added, remove)).toBe("a\r\nb\r\n");
  });
});
