import { describe, expect, it } from "vitest";
import { longFencedCodeBlockRanges, mapFoldRanges, minimalTextChange, rememberMarkdownEditorViewState, restoreMarkdownEditorViewState } from "./markdownFolding";

describe("longFencedCodeBlockRanges", () => {
  it("returns only closed code fences whose body reaches the configured line count", () => {
    const source = ["```ts", ...Array.from({ length: 10 }, (_, index) => `line ${index + 1}`), "```", "", "```", "short", "```"].join("\n");
    const [range] = longFencedCodeBlockRanges(source, 10);
    expect(source.slice(range.from, range.to)).toContain("line 10");
    expect(longFencedCodeBlockRanges(source, 10)).toHaveLength(1);
  });

  it("supports tilde fences and ignores unclosed fences", () => {
    expect(longFencedCodeBlockRanges("~~~\na\nb\n~~~", 2)).toHaveLength(1);
    expect(longFencedCodeBlockRanges("```\na\nb", 2)).toEqual([]);
  });
});

describe("MarkdownEditor view state", () => {
  it("stores scroll, selection, and valid folds independently of the editor generation", () => {
    rememberMarkdownEditorViewState("C:\\docs\\note.md", { content: "0123456789abcdef", scrollTop: 240, scrollLeft: 32, anchor: 8, head: 12, folds: [{ from: 2, to: 6 }, { from: 14, to: 24 }], focused: true });
    expect(restoreMarkdownEditorViewState("C:\\docs\\note.md", "0123456789abcdef")).toEqual({ content: "0123456789abcdef", scrollTop: 240, scrollLeft: 32, anchor: 8, head: 12, folds: [{ from: 2, to: 6 }], focused: true });
  });

  it("maps an unaffected fold when an external update inserts lines before it and unfolds an edited range", () => {
    const change = minimalTextChange("before\n```\nfolded\n```\nafter", "new line\nbefore\n```\nfolded\n```\nafter")!;
    expect(mapFoldRanges([{ from: 10, to: 18 }], change)).toEqual([{ from: 19, to: 27 }]);
    expect(mapFoldRanges([{ from: 4, to: 12 }], minimalTextChange("abcDEFghi", "abcXXghi")!)).toEqual([]);
  });

  it("bounds remembered view states", () => {
    for (let index = 0; index < 65; index += 1) rememberMarkdownEditorViewState(`bounded-${index}`, { content: "x", scrollTop: 0, scrollLeft: 0, anchor: 0, head: 0, folds: [] });
    expect(restoreMarkdownEditorViewState("bounded-0", "x")).toBeNull();
    expect(restoreMarkdownEditorViewState("bounded-64", "x")).not.toBeNull();
  });
});
