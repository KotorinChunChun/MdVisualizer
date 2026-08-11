import { describe, expect, it } from "vitest";
import {
  collectEditableMarkdownOccurrences,
  MarkdownOccurrenceConflictError,
  replaceCodeFenceBody,
  replaceMarkdownOccurrence,
  type CodeFenceOccurrence,
} from "./markdownOccurrences";

describe("editable Markdown occurrences", () => {
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
});
