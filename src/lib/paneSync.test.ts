import { describe, expect, it } from "vitest";
import { scrollDeltaForViewportAnchor, sourceBlockIndexForLine, sourceLineAtViewportTop, sourceTopForLine, synchronizedPaneEndScrollTop } from "./paneSync";

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

  it("interpolates a cursor line between adjacent View source anchors", () => {
    expect(sourceTopForLine([
      { line: 10, top: 120 },
      { line: 20, top: 320 },
    ], 15)).toBe(220);
    expect(sourceTopForLine([{ line: 10, top: 120 }], 99)).toBe(120);
    expect(sourceTopForLine([], 1)).toBeNull();
  });

  it("keeps the cursor anchor at the same screen Y while respecting preview zoom", () => {
    expect(scrollDeltaForViewportAnchor(500, 100, 180)).toBe(220);
    expect(scrollDeltaForViewportAnchor(500, 100, 180, 2)).toBe(110);
  });

  it("aligns pane ends when the cursor is near the Edit end inside the final rendered block", () => {
    expect(synchronizedPaneEndScrollTop(
      { line: 67, remainingScroll: 0, viewportHeight: 320 },
      60,
      { scrollHeight: 1800, clientHeight: 400 },
    )).toBe(1400);
  });

  it("keeps normal source-anchor synchronization away from either pane end", () => {
    expect(synchronizedPaneEndScrollTop(
      { line: 59, remainingScroll: 0, viewportHeight: 320 },
      60,
      { scrollHeight: 1800, clientHeight: 400 },
    )).toBeNull();
    expect(synchronizedPaneEndScrollTop(
      { line: 67, remainingScroll: 80, viewportHeight: 320 },
      60,
      { scrollHeight: 1800, clientHeight: 400 },
    )).toBeNull();
  });
});
