import { describe, expect, it } from "vitest";
import { isDocumentLayout, normalizeViewMode } from "./viewMode";

describe("view mode normalization", () => {
  it.each([
    ["standard", "auto"],
    ["compact", "a4-portrait"],
    ["print", "a4-portrait"],
    ["wide", "a3-portrait"],
  ])("migrates legacy %s to %s", (legacy, expected) => {
    expect(normalizeViewMode(legacy)).toBe(expected);
  });

  it("preserves new layouts and non-document presentation modes", () => {
    expect(normalizeViewMode("auto")).toBe("auto");
    expect(normalizeViewMode("a4-portrait")).toBe("a4-portrait");
    expect(normalizeViewMode("a3-portrait")).toBe("a3-portrait");
    expect(normalizeViewMode("presentation")).toBe("presentation");
    expect(normalizeViewMode("images")).toBe("images");
  });

  it("falls back to auto and identifies only paper-width layouts", () => {
    expect(normalizeViewMode("unknown")).toBe("auto");
    expect(normalizeViewMode(undefined)).toBe("auto");
    expect(isDocumentLayout("auto")).toBe(true);
    expect(isDocumentLayout("presentation")).toBe(false);
  });
});
