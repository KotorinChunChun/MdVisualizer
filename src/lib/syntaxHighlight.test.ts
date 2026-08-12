import { describe, expect, it } from "vitest";
import { applySyntaxHighlightSettings, DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS, normalizeSyntaxHighlightSettings } from "./syntaxHighlight";

describe("syntax highlight settings", () => {
  it("normalizes unknown presets and unsafe color strings", () => {
    expect(normalizeSyntaxHighlightSettings({ theme: "remote-css", customColors: true, background: "url(x)", foreground: "red" }))
      .toEqual({ ...DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS, customColors: true });
    expect(normalizeSyntaxHighlightSettings({ theme: "monokai", customColors: true, background: "#ABCDEF", foreground: "#123456" }))
      .toEqual({ theme: "monokai", customColors: true, background: "#abcdef", foreground: "#123456" });
  });

  it("applies only normalized dataset and CSS variable values and removes disabled overrides", () => {
    const root = document.createElement("div");
    applySyntaxHighlightSettings(root, { theme: "solarized", customColors: true, background: "#002b36", foreground: "#839496" });
    expect(root.dataset.syntaxTheme).toBe("solarized");
    expect(root.style.getPropertyValue("--code-block-bg")).toBe("#002b36");

    applySyntaxHighlightSettings(root, DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS);
    expect(root.dataset.syntaxTheme).toBe("adaptive");
    expect(root.style.getPropertyValue("--code-block-bg")).toBe("");
  });
});
