import { describe, expect, it } from "vitest";
import { collectPreviewMoveUnits, movePreviewUnit } from "../../web/src/previewReorder";

function units(markdown: string, group?: string) {
  return collectPreviewMoveUnits(markdown).filter(unit => group ? unit.group === group : unit.group.startsWith("root:"));
}

describe("web preview source-safe reorder", () => {
  it("moves a complete root paragraph before another block", () => {
    const source = "# 題\n\n最初\n\n次\n";
    const [heading, first, second] = units(source);
    expect(movePreviewUnit(source, second.id, first.id, "before")).toBe("# 題\n\n次\n\n最初\n");
    expect(heading.startLine).toBe(1);
  });

  it("moves a root unit down and to the end without merging paragraphs", () => {
    const source = "A\n\nB\n\nC\n";
    const [a, b, c] = units(source);
    expect(movePreviewUnit(source, a.id, b.id, "after")).toBe("B\n\nA\n\nC\n");
    expect(movePreviewUnit(source, b.id, c.id, "after")).toBe("A\n\nC\n\nB\n");
  });

  it("preserves CRLF source slices and the final newline policy", () => {
    const source = "alpha\r\n\r\nbeta\r\n";
    const [alpha, beta] = units(source);
    expect(movePreviewUnit(source, beta.id, alpha.id, "before")).toBe("beta\r\n\r\nalpha\r\n");
  });

  it("keeps mixed endings and a missing final newline while moving source blocks", () => {
    const source = "one\r\n\r\ntwo\n\nthree";
    const [one, , three] = units(source);
    expect(movePreviewUnit(source, three.id, one.id, "before")).toBe("three\r\n\r\none\n\ntwo");
  });

  it("turns an adjacent heading and paragraph slot into a safe root separator", () => {
    const source = "# A\nparagraph\n\nB\n";
    const [heading, , b] = units(source);
    expect(movePreviewUnit(source, heading.id, b.id, "after")).toBe("paragraph\n\nB\n\n# A\n");
    expect(movePreviewUnit(source, b.id, heading.id, "before")).toBe("B\n\n# A\n\nparagraph\n");
  });

  it("moves an entire fenced block without changing its contents", () => {
    const source = "before\n\n```ts\nconst value = 1;\n```\n\nafter\n";
    const [before, fence, after] = units(source);
    expect(fence.label).toBe("コードブロック");
    expect(movePreviewUnit(source, fence.id, after.id, "after")).toBe("before\n\nafter\n\n```ts\nconst value = 1;\n```\n");
    expect(before.endLine).toBe(1);
  });

  it("moves only sibling list items and keeps nested contents with their parent", () => {
    const source = "- one\n  - nested\n- two\n- three\n";
    const list = units(source).find(unit => unit.label === "リスト")!;
    const items = units(source, `l:${list.id.slice(2)}`);
    expect(items).toHaveLength(3);
    expect(movePreviewUnit(source, items[0].id, items[2].id, "after")).toBe("- two\n- three\n- one\n  - nested\n");
  });

  it("moves body table rows but never exposes header or delimiter as a unit", () => {
    const source = "| A | B |\n| - | - |\n| 1 | x |\n| 2 | y |\n";
    const table = units(source).find(unit => unit.label === "表")!;
    const rows = units(source, `t:${table.id.slice(2)}`);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.startLine)).toEqual([3, 4]);
    expect(movePreviewUnit(source, rows[1].id, rows[0].id, "before")).toBe("| A | B |\n| - | - |\n| 2 | y |\n| 1 | x |\n");
  });

  it("does not mutate stale ids or cross-group requests, and leaves unsupported blocks as barriers", () => {
    const source = "one\n\ntwo\n";
    const [one, two] = units(source);
    expect(movePreviewUnit(source, "r:missing", two.id, "before")).toBe(source);
    expect(movePreviewUnit(source, one.id, "l:0:0", "before")).toBe(source);
    const html = "before\n\n<aside>keep</aside>\n\nafter\n\nlast\n";
    const htmlUnits = units(html);
    expect(htmlUnits.map(unit => unit.label)).toEqual(["before", "after", "last"]);
    expect(movePreviewUnit(html, htmlUnits[2].id, htmlUnits[1].id, "before")).toBe("before\n\n<aside>keep</aside>\n\nlast\n\nafter\n");
    expect(movePreviewUnit(html, htmlUnits[0].id, htmlUnits[1].id, "after")).toBe(html);
  });

  it("uses a definition as a barrier and truncates long labels", () => {
    const text = "x".repeat(100);
    const source = `${text}\n\n[id]: https://example.test\n\nleft\n\nright\n`;
    const root = units(source);
    expect(root[0].label).toHaveLength(80);
    expect(movePreviewUnit(source, root[2].id, root[1].id, "before")).toBe(`${text}\n\n[id]: https://example.test\n\nright\n\nleft\n`);
  });
});
