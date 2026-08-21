import { describe, expect, it } from "vitest";
import {
  buildShortcutKeySvg,
  isShortcutKeySource,
  normalizeShortcutKeyToken,
  parseShortcutKeySequence,
} from "@markdown-viewer/markdown-core";

describe("shortcut key rendering", () => {
  it("normalizes the requested modifier names", () => {
    expect(normalizeShortcutKeyToken("Ctrl")).toEqual({ label: "Ctrl", kind: "modifier" });
    expect(normalizeShortcutKeyToken("Shift")).toEqual({ label: "Shift", kind: "modifier" });
    expect(normalizeShortcutKeyToken("Alt")).toEqual({ label: "Alt", kind: "modifier" });
    expect(normalizeShortcutKeyToken("Windows")).toEqual({ label: "Windows", kind: "modifier" });
    expect(normalizeShortcutKeyToken("Fn")).toEqual({ label: "Fn", kind: "modifier" });
  });

  it("parses simultaneous and sequential key groups", () => {
    expect(parseShortcutKeySequence("Ctrl+Shift+S, Ctrl+C")).toEqual({
      groups: [
        { tokens: [{ label: "Ctrl", kind: "modifier" }, { label: "Shift", kind: "modifier" }, { label: "S", kind: "key" }] },
        { tokens: [{ label: "Ctrl", kind: "modifier" }, { label: "C", kind: "key" }] },
      ],
      separators: [","],
      label: "Ctrl + Shift + S , Ctrl + C",
    });
  });

  it("recognizes only shortcut-like inline code", () => {
    expect(isShortcutKeySource("Ctrl")).toBe(true);
    expect(isShortcutKeySource("Windows+E")).toBe(true);
    expect(isShortcutKeySource("Fn+F5")).toBe(true);
    expect(isShortcutKeySource("ordinary code")).toBe(false);
    expect(isShortcutKeySource("S")).toBe(false);
  });

  it("builds accessible SVG for inline and block variants", () => {
    const inline = buildShortcutKeySvg("Ctrl+S", { variant: "inline" });
    const block = buildShortcutKeySvg("Ctrl+S", { variant: "block" });
    expect(inline).toContain('class="shortcut-key-svg shortcut-key-svg--inline"');
    expect(block).toContain('class="shortcut-key-svg shortcut-key-svg--block"');
    expect(block).toContain('aria-label="キーボードショートカット: Ctrl + S"');
    expect(block).toContain('data-shortcut-token="Ctrl"');
    expect(block).toContain('data-shortcut-token="S"');
  });

  it("escapes labels and source attributes in generated SVG", () => {
    const svg = buildShortcutKeySvg("Ctrl+&", { variant: "block" });
    expect(svg).not.toContain('data-shortcut-token="&"');
    expect(svg).toContain("data-shortcut-source=\"Ctrl+&amp;\"");
  });
});
