import { describe, expect, it } from "vitest";
import { buildMarkdownEdit } from "./markdownEditing";

describe("buildMarkdownEdit", () => {
  it("wraps the current selection and keeps the body selected", () => {
    expect(buildMarkdownEdit("before text after", 7, 11, "bold")).toEqual({
      from: 7,
      to: 11,
      insert: "**text**",
      anchor: 9,
      head: 13,
    });
  });

  it("prefixes every selected line for task lists", () => {
    expect(buildMarkdownEdit("alpha\nbeta\ngamma", 0, 10, "task-list")).toMatchObject({
      from: 0,
      to: 10,
      insert: "- [ ] alpha\n- [ ] beta",
    });
  });

  it("replaces an existing heading marker instead of stacking markers", () => {
    expect(buildMarkdownEdit("### Heading", 5, 5, "heading")).toMatchObject({
      from: 0,
      to: 11,
      insert: "# Heading",
    });
  });

  it("inserts draw.io XML in a fenced block", () => {
    const change = buildMarkdownEdit("", 0, 0, "drawio");
    expect(change.insert).toContain("```drawio");
    expect(change.insert).toContain("<mxGraphModel>");
  });

  it("inserts a sample SVG with a circle and label in a fenced block", () => {
    const change = buildMarkdownEdit("", 0, 0, "svg");
    expect(change.insert).toContain("```svg");
    expect(change.insert).toContain("<circle");
    expect(change.insert).toContain("SVGサンプル");
    expect(change.anchor).toBe(change.from + change.insert.indexOf("<svg"));
  });
});
