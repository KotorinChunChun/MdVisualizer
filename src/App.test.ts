import { describe, expect, it, vi } from "vitest";
import { focusAndSelectSearchInput, moveZoomLevel, normalizeZoom, resolveDocumentSidePanel, ZOOM_LEVELS } from "./App";

describe("zoom level selection", () => {
  it("normalizes persisted values to a selectable status-bar option", () => {
    expect(normalizeZoom(77)).toBe(80);
    expect(normalizeZoom(210)).toBe(200);
    expect(normalizeZoom(40)).toBe(50);
  });

  it("moves shortcuts through the fixed option list without producing gaps", () => {
    expect(moveZoomLevel(70, 1)).toBe(80);
    expect(moveZoomLevel(80, -1)).toBe(70);
    expect(moveZoomLevel(50, -1)).toBe(50);
    expect(moveZoomLevel(200, 1)).toBe(200);
    expect(ZOOM_LEVELS).toContain(moveZoomLevel(100, 1));
  });
});

describe("search input focus", () => {
  it("focuses the search box and selects the complete existing query", () => {
    const input = document.createElement("input");
    input.value = "cargo";
    const select = vi.spyOn(input, "select");
    document.body.append(input);

    focusAndSelectSearchInput(input);

    expect(document.activeElement).toBe(input);
    expect(select).toHaveBeenCalledOnce();
    input.remove();
  });
});

describe("document side panel ownership", () => {
  it("gives search results priority without discarding the requested TOC state", () => {
    expect(resolveDocumentSidePanel(true, "toc")).toBe("search");
    expect(resolveDocumentSidePanel(false, "toc")).toBe("toc");
    expect(resolveDocumentSidePanel(false, "images")).toBe("images");
    expect(resolveDocumentSidePanel(false, null)).toBeNull();
  });
});
