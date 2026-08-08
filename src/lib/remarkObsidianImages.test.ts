import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { parseObsidianImageReference, remarkObsidianImages } from "./remarkObsidianImages";

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
    const markdown = "[[設計ノート]] `[[code.png]]` [[manual.md]]";
    expect(imageNodes(markdown)).toEqual([]);
  });

  it("treats Obsidian size aliases as dimensions rather than visible alt text", () => {
    expect(parseObsidianImageReference("photo.webp|320x200")).toEqual({
      source: "photo.webp",
      alt: "",
    });
  });
});
