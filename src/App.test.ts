import { describe, expect, it } from "vitest";
import { moveZoomLevel, normalizeZoom, ZOOM_LEVELS } from "./App";

describe("zoom level selection", () => {
  it("normalizes persisted values to a selectable status-bar option", () => {
    expect(normalizeZoom(77)).toBe(80);
    expect(normalizeZoom(210)).toBe(200);
    expect(normalizeZoom(40)).toBe(50);
  });

  it("moves shortcuts through the fixed option list without producing gaps", () => {
    expect(moveZoomLevel(67, 1)).toBe(80);
    expect(moveZoomLevel(80, -1)).toBe(67);
    expect(moveZoomLevel(50, -1)).toBe(50);
    expect(moveZoomLevel(200, 1)).toBe(200);
    expect(ZOOM_LEVELS).toContain(moveZoomLevel(100, 1));
  });
});
