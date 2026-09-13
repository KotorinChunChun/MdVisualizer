import { describe, expect, it } from "vitest";
import {
  buildShortcutKeySvg,
  isShortcutKeySource,
  normalizeShortcutKeyToken,
  parseShortcutKeySequence,
} from "@mdvisualizer/markdown-core";

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
    expect(isShortcutKeySource("S+Ctrl")).toBe(false);
  });

  it("accepts symbol keys and Japanese operation names after a leading modifier", () => {
    for (const source of ["Ctrl+.", "Ctrl+[", "Ctrl+]", "Ctrl+マウスホイール", "Alt+←", "Windows++", "Ctrl++", "Ctrl+,"]) {
      expect(isShortcutKeySource(source), source).toBe(true);
    }
    expect(parseShortcutKeySequence("Ctrl+マウスホイール")?.label).toBe("Ctrl + マウスホイール");
    expect(parseShortcutKeySequence("Alt+←")?.groups[0].tokens[1]).toEqual({ label: "←", kind: "key" });
    expect(parseShortcutKeySequence("Windows++")?.groups[0].tokens[1]).toEqual({ label: "+", kind: "key" });
    expect(parseShortcutKeySequence("Ctrl++")?.label).toBe("Ctrl + +");
    expect(parseShortcutKeySequence("Ctrl+C → Ctrl+V")?.separators).toEqual(["→"]);
  });

  it("gives inline key labels and plus separators independent visual space", () => {
    const svg = buildShortcutKeySvg("Ctrl+X", { variant: "inline" });
    const keyFaces = [...svg.matchAll(/class="shortcut-key-svg__face" x="([^"]+)"[^>]*width="([^"]+)"/g)]
      .map((match) => ({ x: Number(match[1]), width: Number(match[2]) }));
    expect(svg.match(/class="shortcut-key-svg__label"[^>]*font-size="([^"]+)"/)?.[1]).toBe("24");
    expect(svg.match(/class="shortcut-key-svg__separator"[^>]*font-size="([^"]+)"[^>]*>\+<\/text>/)?.[1]).toBe("24");
    expect(keyFaces).toHaveLength(2);
    expect(keyFaces[1].x - (keyFaces[0].x + keyFaces[0].width)).toBeGreaterThanOrEqual(24 * 0.75 + 16);
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
    expect(svg).toContain('data-shortcut-token="&amp;"');
    expect(svg).toContain("data-shortcut-source=\"Ctrl+&amp;\"");
  });
});
