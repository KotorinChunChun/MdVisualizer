import { describe, expect, it } from "vitest";
import {
  buildStructuredListEnter,
  buildStructuredListSoftEnter,
  buildStructuredListIndent,
  buildStructuredListMove,
  buildStructuredListPaste,
  buildStructuredListToggle,
  normalizeStructuredListIndentationForRendering,
  renumberOrderedLists,
} from "./markdownEditing";

function apply(source: string, change: { from: number; to: number; insert: string } | null): string {
  if (!change) return source;
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}

describe("structured Markdown lists", () => {
  it("renumbers ordered items independently at each nested level", () => {
    expect(renumberOrderedLists("8. A\n   9. A-1\n   4. A-2\n3. B\n   7. B-1"))
      .toBe("1. A\n   1. A-1\n   2. A-2\n2. B\n   1. B-1");
    expect(renumberOrderedLists("4. first\n   continuation\n9. second")).toBe("1. first\n   continuation\n2. second");
  });

  it("toggles bullets and both checkbox states without stacking markers", () => {
    expect(apply("alpha\nbeta", buildStructuredListToggle("alpha\nbeta", 0, 10, "unordered"))).toBe("- alpha\n- beta");
    expect(apply("- alpha", buildStructuredListToggle("- alpha", 2, 2, "unordered"))).toBe("alpha");
    expect(apply("- [ ] item", buildStructuredListToggle("- [ ] item", 6, 6, "task-checked"))).toBe("- [x] item");
    expect(apply("- [x] item", buildStructuredListToggle("- [x] item", 6, 6, "task-checked"))).toBe("item");
  });

  it("ignores fenced code while toggling multiple lines", () => {
    const source = "```md\n1. code\n```\nplain";
    expect(apply(source, buildStructuredListToggle(source, 0, source.length, "ordered")))
      .toBe("```md\n1. code\n```\n1. plain");
  });

  it("continues numbered items and exits an empty item", () => {
    expect(apply("1. one", buildStructuredListEnter("1. one", 6, 6))).toBe("1. one\n2. ");
    expect(apply("1. one\n2. ", buildStructuredListEnter("1. one\n2. ", 11, 11))).toBe("1. one\n");
  });

  it("continues numbered items at every indentation depth", () => {
    const source = "1. outer\n  1. child\n    1. deep";
    expect(apply(source, buildStructuredListEnter(source, source.length, source.length)))
      .toBe("1. outer\n  1. child\n    1. deep\n    2. ");
  });

  it("adds one indentation level without a marker on Shift+Enter", () => {
    const source = "1. outer\n  1. child\n    1. deep";
    const change = buildStructuredListSoftEnter(source, source.length, source.length);
    expect(apply(source, change)).toBe("1. outer\n  1. child\n    1. deep\n      ");
    expect(change?.anchor).toBe(source.length + 7);
  });

  it("normalizes compact list levels for rendering without changing source offsets", () => {
    const source = "1. outer\r\n  1. child\r\n     - odd bullet\r\n       - odd child\r\n2. next";
    const normalized = normalizeStructuredListIndentationForRendering(source);
    expect(normalized).toBe("1. outer\r\n\t 1. child\r\n\t \t \t- odd bullet\r\n\t \t \t \t- odd child\r\n2. next");
    expect(normalized).toHaveLength(source.length);
    expect(normalizeStructuredListIndentationForRendering("    1. code\n\n```md\n  1. literal\n```")).toBe("    1. code\n\n```md\n  1. literal\n```");
    expect(normalizeStructuredListIndentationForRendering("1. parent\n   1. standard child\n2. next"))
      .toBe("1. parent\n   1. standard child\n2. next");
  });

  it("indents an item and renumbers its old and new levels", () => {
    const source = "1. first\n8. second\n9. third";
    expect(apply(source, buildStructuredListIndent(source, 12, 12))).toBe("1. first\n  1. second\n2. third");
  });

  it("replaces an empty marker when a list is pasted", () => {
    expect(apply("- ", buildStructuredListPaste("- ", 2, 2, "- alpha\n- beta"))).toBe("- alpha\n- beta");
  });

  it("moves only between same-level siblings and carries child items", () => {
    const source = "1. first\n   1. child\n2. second\n3. third";
    expect(apply(source, buildStructuredListMove(source, 3, 1))).toBe("1. second\n2. first\n   1. child\n3. third");
    expect(buildStructuredListMove(source, source.indexOf("child"), -1)).toBeNull();
  });
});
