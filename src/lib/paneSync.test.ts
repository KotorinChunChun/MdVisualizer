import { describe, expect, it } from "vitest";
import { sourceBlockIndexForLine, sourceLineAtViewportTop } from "./paneSync";

describe("pane source-position synchronization", () => {
  it("uses the last source block that has crossed the View pane top", () => {
    expect(sourceLineAtViewportTop([
      { line: 1, top: 20 },
      { line: 5, top: 99 },
      { line: 12, top: 140 },
    ], 100)).toBe(5);
  });

  it("maps an Edit line to the closest preceding View block", () => {
    expect(sourceBlockIndexForLine([1, 5, 12, 30], 11)).toBe(1);
    expect(sourceBlockIndexForLine([1, 5, 12, 30], 30)).toBe(3);
    expect(sourceBlockIndexForLine([], 4)).toBe(-1);
  });
});
