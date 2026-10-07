import { describe, expect, it } from "vitest";
import {
  codeFenceAlt,
  codeFenceTitle,
  collectEditableMarkdownOccurrences,
  MarkdownOccurrenceConflictError,
  replaceCodeFenceBody,
  replaceMarkdownOccurrence,
  serializeMarkdownTable,
  type CodeFenceOccurrence,
  type MarkdownTableOccurrence,
} from "./markdownOccurrences";

describe("editable Markdown occurrences", () => {
  it("extracts quoted and unquoted diagram titles from fence metadata", () => {
    expect(codeFenceTitle('title="システム 構成"')).toBe("システム 構成");
    expect(codeFenceTitle("caption='処理フロー'")).toBe("処理フロー");
    expect(codeFenceTitle("title=overview other=value")).toBe("overview");
    expect(codeFenceTitle("other=value")).toBeUndefined();
  });

  it("extracts optional quoted and unquoted alt text from fence metadata", () => {
    expect(codeFenceAlt('title="diagram" alt="説明テキスト"')).toBe("説明テキスト");
    expect(codeFenceAlt("alt='処理フロー'")).toBe("処理フロー");
    expect(codeFenceAlt("alt=overview other=value")).toBe("overview");
    expect(codeFenceAlt('title="diagram"')).toBeUndefined();
  });

  it("collects fenced blocks, duplicate images, HTML images, and inline SVG with exact ranges", () => {
    const markdown = [
      "```csv",
      "name,value",
      "one,1",
      "```",
      "",
      "![first](same.png)",
      "![second](same.png)",
      '<img src="photo.jpg" alt="HTML">',
      '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>',
    ].join("\n");
    const occurrences = collectEditableMarkdownOccurrences(markdown);

    expect(occurrences.map((item) => item.kind)).toEqual(["code-fence", "image", "image", "image", "inline-svg"]);
    expect(occurrences.map((item) => markdown.slice(item.start, item.end))).toEqual(occurrences.map((item) => item.expected));
    expect(occurrences.filter((item) => item.kind === "image").map((item) => item.source)).toEqual(["same.png", "same.png", "photo.jpg"]);
    expect(occurrences[occurrences.length - 1]?.sourceLine).toBe(9);
  });

  it("ignores image, SVG, and fence-looking text inside another code fence", () => {
    const markdown = "````text\n![not-image](inside.png)\n<svg><path/></svg>\n```drawio\nvalue\n```\n````";
    const occurrences = collectEditableMarkdownOccurrences(markdown);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ kind: "code-fence", language: "text" });
  });

  it("does not treat SVG-looking text in comments, scripts, or inline code as an editable SVG", () => {
    const markdown = [
      "<!-- <svg><path/></svg> -->",
      "",
      "<script>const sample = '<svg><path/></svg>';</script>",
      "",
      "`<svg><path/></svg>`",
    ].join("\n");

    expect(collectEditableMarkdownOccurrences(markdown)).toEqual([]);
  });

  it("HTMLコンテナー内のコメントとコードから画像・SVGを抽出せず、実要素の位置を維持する", () => {
    const markdown = '<div>\r\n<!-- <img src="hidden.png"><svg><path/></svg> -->\r\n<pre><img src="code.png"><svg/></pre>\r\n<img src="visible.png">\r\n<svg id="visible"/>\r\n</div>';
    const occurrences = collectEditableMarkdownOccurrences(markdown);
    expect(occurrences.map(item => item.expected)).toEqual(['<img src="visible.png">', '<svg id="visible"/>']);
    expect(occurrences.map(item => markdown.slice(item.start, item.end))).toEqual(occurrences.map(item => item.expected));
    expect(occurrences.map(item => item.sourceLine)).toEqual([4, 5]);
  });

  it("属性のコメント開始風文字列で後続の実画像を除外しない", () => {
    const markdown = '<div title="<!--">\n<img src="visible.png">\n</div>';
    expect(collectEditableMarkdownOccurrences(markdown).map(item => item.expected)).toEqual(['<img src="visible.png">']);
  });

  it("replaces only the selected duplicate occurrence", () => {
    const markdown = "![same](image.png)\n\n![same](image.png)";
    const images = collectEditableMarkdownOccurrences(markdown).filter((item) => item.kind === "image");
    const replaced = replaceMarkdownOccurrence(markdown, images[1], "![changed](other.png)");

    expect(replaced).toBe("![same](image.png)\n\n![changed](other.png)");
  });

  it("rejects a stale occurrence instead of relocating it to an identical element", () => {
    const markdown = "prefix\n![same](image.png)\n![same](image.png)";
    const image = collectEditableMarkdownOccurrences(markdown).filter((item) => item.kind === "image")[1];
    const changedBeforeTarget = `new-${markdown}`;

    expect(() => replaceMarkdownOccurrence(changedBeforeTarget, image, "![changed](other.png)"))
      .toThrow(MarkdownOccurrenceConflictError);
  });

  it("preserves a tilde fence, metadata, and CRLF while replacing its body", () => {
    const markdown = "~~~tsv-h title=\"顧客\"\r\nold\tvalue\r\n~~~\r\n\r\nafter";
    const fence = collectEditableMarkdownOccurrences(markdown)[0] as CodeFenceOccurrence;
    const replaced = replaceCodeFenceBody(markdown, fence, "new\tvalue\nnext\trow");

    expect(fence).toMatchObject({ language: "tsv-h", meta: 'title=\"顧客\"', body: "old\tvalue", lineEnding: "\r\n" });
    expect(replaced).toBe("~~~tsv-h title=\"顧客\"\r\nnew\tvalue\r\nnext\trow\r\n~~~\r\n\r\nafter");
  });

  it("preserves a block quote container while replacing a nested fence", () => {
    const markdown = "> ```drawio\n> old\n> ```";
    const fence = collectEditableMarkdownOccurrences(markdown)[0] as CodeFenceOccurrence;
    const replaced = replaceCodeFenceBody(markdown, fence, "new\nnext");

    expect(fence).toMatchObject({ language: "drawio", body: "old", continuationPrefix: "> " });
    expect(replaced).toBe("> ```drawio\n> new\n> next\n> ```");
  });

  it("collects GFM tables with raw cells, alignment, exact ranges, and CRLF", () => {
    const tableSource = "| **名前** | 操作 |\r\n| :--- | ---: |\r\n| Alice | Ctrl+\\| |";
    const markdown = `前\r\n\r\n${tableSource}\r\n\r\n後`;
    const table = collectEditableMarkdownOccurrences(markdown).find((item): item is MarkdownTableOccurrence => item.kind === "table");

    expect(table).toMatchObject({
      expected: tableSource,
      headers: ["**名前**", "操作"],
      rows: [["Alice", "Ctrl+\\|"]],
      alignments: ["left", "right"],
      lineEnding: "\r\n",
    });
    expect(markdown.slice(table!.start, table!.end)).toBe(tableSource);
  });

  it("serializes table edits while escaping pipes and normalizing cell newlines", () => {
    const serialized = serializeMarkdownTable({
      headers: ["name", "note"],
      rows: [["Alice", "A|B\nnext"]],
      alignments: [null, "center"],
      lineEnding: "\r\n",
    });

    expect(serialized).toBe("| name | note |\r\n| --- | :---: |\r\n| Alice | A\\|B<br>next |");
  });

  it("serializes calculated aggregate cells", () => {
    const serialized = serializeMarkdownTable({
      headers: ["項目", "値", "平均"],
      rows: [["A", "10", "old"], ["B", "20", "old"], ["合計", "old", "old"]],
      alignments: [null, "right", "right"],
      lineEnding: "\n",
    });

    expect(serialized).toContain("| A | 10 | 10 |");
    expect(serialized).toContain("| 合計 | 30 | - |");
  });

  it("preserves a block quote container while serializing a nested GFM table", () => {
    const markdown = "> | A | B |\n> | --- | --- |\n> | 1 | 2 |";
    const table = collectEditableMarkdownOccurrences(markdown).find((item): item is MarkdownTableOccurrence => item.kind === "table");

    expect(table).toMatchObject({ headers: ["A", "B"], rows: [["1", "2"]], continuationPrefix: "> " });
    const replacement = serializeMarkdownTable({ ...table!, rows: [["3", "4"]] });
    expect(replacement).toBe("| A | B |\n> | --- | --- |\n> | 3 | 4 |");
    expect(replaceMarkdownOccurrence(markdown, table!, replacement)).toBe("> | A | B |\n> | --- | --- |\n> | 3 | 4 |");
  });
});
