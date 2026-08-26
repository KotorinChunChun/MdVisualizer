import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { parseObsidianImageReference, parseObsidianMarkdownLinkReference, remarkObsidianImages } from "./remarkObsidianImages";

type Node = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  position?: { start?: { offset?: number } };
  children?: Node[];
};

const parser = unified().use(remarkParse).use(remarkObsidianImages);

function imageNodes(markdown: string): Node[] {
  const tree = parser.runSync(parser.parse(markdown)) as Node;
  const images: Node[] = [];
  const visit = (node: Node) => {
    if (node.type === "image") images.push(node);
    node.children?.forEach(visit);
  };
  visit(tree);
  return images;
}

describe("remarkObsidianImages", () => {
  it("supports embeds with and without the Obsidian exclamation mark", () => {
    const markdown = "前 ![[images/構成図.png|システム構成]] 後 [[assets/photo.jpg]]";
    expect(imageNodes(markdown).map((node) => ({
      url: node.url,
      alt: node.alt,
      offset: node.position?.start?.offset,
    }))).toEqual([
      { url: "images/構成図.png", alt: "システム構成", offset: 2 },
      { url: "assets/photo.jpg", alt: "", offset: 31 },
    ]);
  });

  it("leaves notes, inline code, and non-image wiki links unchanged", () => {
    const markdown = "[[設計ノート]] `[[code.png]]` [[diagram.txt]]";
    expect(imageNodes(markdown)).toEqual([]);
  });

  it("treats draw.io files as Obsidian image embeds", () => {
    expect(parseObsidianImageReference("diagrams/system.drawio|システム構成")).toEqual({
      source: "diagrams/system.drawio",
      alt: "システム構成",
    });
    expect(imageNodes("![[diagrams/system.drawio|システム構成]]")).toMatchObject([
      { url: "diagrams/system.drawio", alt: "システム構成" },
    ]);
  });

  it("converts local Markdown wiki links while leaving other wiki links alone", () => {
    expect(parseObsidianMarkdownLinkReference("linked-document.md|リンク先")).toEqual({ source: "linked-document.md", label: "リンク先" });
    expect(parseObsidianMarkdownLinkReference("note.txt")).toBeNull();
    const tree = parser.runSync(parser.parse("[[linked-document.md]] [[設計ノート]]")) as Node;
    expect(tree.children?.[0]?.children?.map((node) => ({ type: node.type, url: node.url, value: node.value }))).toEqual([
      { type: "link", url: "linked-document.md", value: undefined },
      { type: "text", url: undefined, value: " [[設計ノート]]" },
    ]);
  });

  it("converts standalone Mermaid wiki links", () => {
    expect(parseObsidianMarkdownLinkReference("flow.mmd|フロー図")).toEqual({ source: "flow.mmd", label: "フロー図" });
    expect(parseObsidianMarkdownLinkReference("sequence.mermaid")).toEqual({ source: "sequence.mermaid", label: "sequence.mermaid" });
    expect(imageNodes("![[flow.mmd|フロー図]]")).toMatchObject([{ url: "flow.mmd", alt: "フロー図" }]);
  });

  it("treats Obsidian size aliases as dimensions rather than visible alt text", () => {
    expect(parseObsidianImageReference("photo.webp|320x200")).toEqual({
      source: "photo.webp",
      alt: "",
    });
  });
});
