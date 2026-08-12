import { describe, expect, it } from "vitest";
import { applyPrintStyleSettings, DEFAULT_PRINT_STYLE_SETTINGS, normalizePrintStyleSettings } from "./printStyle";

describe("print style settings", () => {
  it("normalizes unsafe colors and arbitrary font strings", () => {
    expect(normalizePrintStyleSettings({ headingColor: "url(x)", borderColor: "red", backgroundColor: "#ABCDEF", fontFamily: "Comic Sans; color:red", monochrome: 1 }))
      .toEqual({ ...DEFAULT_PRINT_STYLE_SETTINGS, backgroundColor: "#abcdef" });
  });

  it("applies a fixed font stack and print-only variables", () => {
    const root = document.createElement("div");
    applyPrintStyleSettings(root, { headingColor: "#111111", borderColor: "#222222", backgroundColor: "#eeeeee", fontFamily: "serif", monochrome: true });
    expect(root.style.getPropertyValue("--print-heading-color")).toBe("#111111");
    expect(root.style.getPropertyValue("--print-font-family")).toContain("Georgia");
    expect(root.dataset.printMonochrome).toBe("true");
  });
});
