import { describe, expect, it } from "vitest";
import { buildDocumentDiff, changedLineNumbers } from "./documentDiff";

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
});
