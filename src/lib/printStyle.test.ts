import { describe, expect, it } from "vitest";
import { applyPrintStyleSettings, DEFAULT_PRINT_STYLE_SETTINGS, needsPrintStyleSettingsMigration, normalizePrintStyleSettings } from "./printStyle";

describe("print style settings", () => {
  it("normalizes unsafe colors and arbitrary font strings", () => {
    expect(normalizePrintStyleSettings({ headingColor: "url(x)", borderColor: "red", backgroundColor: "#ABCDEF", fontFamily: "Comic Sans; color:red", monochrome: 1 }))
      .toEqual({ ...DEFAULT_PRINT_STYLE_SETTINGS, backgroundColor: "#abcdef" });
  });

  it("recognizes the pre-metadata object as a value that must be migrated", () => {
    const legacy = { headingColor: "#1f2328", borderColor: "#d0d7de", backgroundColor: "#ffffff", fontFamily: "system", monochrome: false };
    expect(needsPrintStyleSettingsMigration(legacy)).toBe(true);
    expect(normalizePrintStyleSettings(legacy)).toEqual(DEFAULT_PRINT_STYLE_SETTINGS);
    expect(needsPrintStyleSettingsMigration(DEFAULT_PRINT_STYLE_SETTINGS)).toBe(false);
  });

  it("does not accept a partial runtime value when applying CSS variables", () => {
    const root = document.createElement("div");
    applyPrintStyleSettings(root, { headingColor: "url(x)", borderColor: "red", backgroundColor: "#ABCDEF", fontFamily: "serif", monochrome: true } as never);
    expect(root.style.getPropertyValue("--print-heading-color")).toBe(DEFAULT_PRINT_STYLE_SETTINGS.headingColor);
    expect(root.style.getPropertyValue("--print-background-color")).toBe("#abcdef");
  });

  it("applies a fixed font stack and print-only variables", () => {
    const root = document.createElement("div");
    applyPrintStyleSettings(root, { ...DEFAULT_PRINT_STYLE_SETTINGS, headingColor: "#111111", borderColor: "#222222", backgroundColor: "#eeeeee", fontFamily: "serif", monochrome: true });
    expect(root.style.getPropertyValue("--print-heading-color")).toBe("#111111");
    expect(root.style.getPropertyValue("--print-font-family")).toContain("Georgia");
    expect(root.dataset.printMonochrome).toBe("true");
  });
});
