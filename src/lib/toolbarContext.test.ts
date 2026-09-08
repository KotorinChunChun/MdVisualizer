import { describe, expect, it } from "vitest";
import { buildContextualMarkdownEdit, isMarkdownToolbarActionDisabled, resolveMarkdownInsertionContext, type MarkdownEditAction, type MarkdownEditChange } from "./markdownEditing";

function apply(source: string, change: MarkdownEditChange | null): string {
  return change ? source.slice(0, change.from) + change.insert + source.slice(change.to) : source;
}

describe("Markdown toolbar insertion context", () => {
  it.each(["table", "mermaid", "drawio"] satisfies MarkdownEditAction[])("moves %s after the current fenced code block", (action) => {
    const source = "before\n```typescript\nconst value = 1;\n```\nafter";
    const cursor = source.indexOf("value");
    const change = buildContextualMarkdownEdit(source, cursor, cursor, action);
    const output = apply(source, change);

    expect(change?.from).toBe(source.indexOf("after"));
    expect(output.indexOf(action === "table" ? "| 列1" : `\`\`\`${action}`)).toBeGreaterThan(output.indexOf("const value = 1;"));
    expect(output.indexOf(action === "table" ? "| 列1" : `\`\`\`${action}`)).toBeLessThan(output.indexOf("after"));
  });

  it("recognises long tilde fences and CRLF boundaries", () => {
    const source = "~~~~lang\r\ninside\r\n~~~~\r\ntail";
    const cursor = source.indexOf("inside") + 2;
    const context = resolveMarkdownInsertionContext(source, cursor);
    expect(context).toMatchObject({ kind: "fenced-code", position: source.indexOf("tail") });
  });

  it("closes an unfinished fence before inserting a new block", () => {
    const source = "```typescript\nconst value = 1;";
    const change = buildContextualMarkdownEdit(source, source.length, source.length, "mermaid");
    const output = apply(source, change);
    expect(output).toContain("const value = 1;\n```\n\n\n```mermaid");
    expect((output.match(/```/g) ?? [])).toHaveLength(4);
  });

  it.each([
    "![]()",
    "![diagram](images/architecture(v2).png)",
    "[documentation](https://example.test/a_(b))",
    "![diagram][architecture]",
  ])("moves a block after the complete image or link syntax: %s", (syntax) => {
    const source = `before ${syntax} after`;
    const cursor = source.indexOf(syntax) + Math.floor(syntax.length / 2);
    const change = buildContextualMarkdownEdit(source, cursor, cursor, "drawio");
    expect(change?.from).toBe(source.indexOf(syntax) + syntax.length);
  });

  it("moves a block after the complete inline-code span", () => {
    const source = "before ``code ` fragment`` after";
    const cursor = source.indexOf("fragment");
    expect(resolveMarkdownInsertionContext(source, cursor)).toMatchObject({
      kind: "inline-code",
      position: source.indexOf(" after"),
    });
  });

  it.each(["code-block", "table", "mermaid", "horizontal-rule", "drawio"] satisfies MarkdownEditAction[])("disables %s inside a GFM table", (action) => {
    const source = "| Name | Value |\n| :--- | ---: |\n| alpha | beta |\n\noutside";
    const cursor = source.indexOf("beta");
    expect(isMarkdownToolbarActionDisabled(source, cursor, action)).toBe(true);
    expect(buildContextualMarkdownEdit(source, cursor, cursor, action)).toBeNull();
    expect(isMarkdownToolbarActionDisabled(source, source.indexOf("outside"), action)).toBe(false);
  });

  it("keeps inline actions and safe block selections at their authored position", () => {
    const source = "select this text";
    const selectedStart = source.indexOf("this");
    expect(buildContextualMarkdownEdit(source, selectedStart, selectedStart + 4, "bold")).toMatchObject({ from: selectedStart, to: selectedStart + 4 });
    expect(buildContextualMarkdownEdit(source, selectedStart, selectedStart + 4, "mermaid")).toMatchObject({ from: selectedStart, to: selectedStart + 4 });
  });
});
