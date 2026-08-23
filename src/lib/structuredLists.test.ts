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

  it("preserves the following line and original line ending when Enter splits a list item", () => {
    const lf = "1. one\n2. next";
    const lfChange = buildStructuredListEnter(lf, "1. one".length, "1. one".length);
    expect(apply(lf, lfChange)).toBe("1. one\n2. \n3. next");
    expect(lfChange?.anchor).toBe("1. one\n2. ".length);

    const crlf = "1. one\r\n2. next";
    const crlfChange = buildStructuredListEnter(crlf, "1. one".length, "1. one".length);
    expect(apply(crlf, crlfChange)).toBe("1. one\r\n2. \r\n3. next");
    expect(crlfChange?.anchor).toBe("1. one\r\n2. ".length);
  });

  it("preserves the following line when Shift+Enter inserts a continuation", () => {
    const source = "1. one\n2. next";
    const change = buildStructuredListSoftEnter(source, "1. one".length, "1. one".length);
    expect(apply(source, change)).toBe("1. one\n  \n2. next");
    expect(change?.anchor).toBe("1. one\n  ".length);
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

  it("inserts Tab indentation at the current line start and maps the caret by the inserted width", () => {
    const source = "alpha\nbeta";
    const position = source.indexOf("t");
    const change = buildStructuredListIndent(source, position, position);
    expect(apply(source, change)).toBe("alpha\n  beta");
    expect(change?.anchor).toBe(position + 2);
    expect(change?.head).toBe(position + 2);

    const lineStart = source.indexOf("beta");
    const atStart = buildStructuredListIndent(source, lineStart, lineStart);
    expect(apply(source, atStart)).toBe("alpha\n  beta");
    expect(atStart?.anchor).toBe(lineStart + 2);
  });

  it("indents every selected line at its start and outdents without shifting text incorrectly", () => {
    const source = "alpha\r\nbeta\r\ngamma";
    const change = buildStructuredListIndent(source, 2, source.indexOf("gamma") - 2);
    expect(apply(source, change)).toBe("  alpha\r\n  beta\r\ngamma");
    expect(change?.anchor).toBe(4);

    const indented = "  alpha\n\tbeta";
    const outdent = buildStructuredListIndent(indented, 1, indented.length, true);
    expect(apply(indented, outdent)).toBe("alpha\nbeta");
    expect(outdent?.anchor).toBe(0);
    expect(outdent?.head).toBe("alpha\nbeta".length);
  });

  it("replaces an empty marker when a list is pasted", () => {
    expect(apply("- ", buildStructuredListPaste("- ", 2, 2, "- alpha\n- beta"))).toBe("- alpha\n- beta");
  });

  it("moves only between same-level siblings and carries child items", () => {
    const source = "1. first\n   1. child\n2. second\n3. third";
    expect(apply(source, buildStructuredListMove(source, 3, 1))).toBe("1. second\n2. first\n   1. child\n3. third");
    expect(buildStructuredListMove(source, source.indexOf("child"), -1)).toBeNull();
  });

  it("moves CRLF item blocks without losing or joining neighboring line data", () => {
    const source = "1. first\r\n   1. child\r\n2. second\r\n3. third\r\nafter";
    const change = buildStructuredListMove(source, source.indexOf("first"), 1);
    expect(apply(source, change)).toBe("1. second\r\n2. first\r\n   1. child\r\n3. third\r\nafter");
  });
});
