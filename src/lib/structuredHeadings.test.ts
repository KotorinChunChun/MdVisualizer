import { describe, expect, it } from "vitest";
import { moveHeadingBlock, normalizeNumberedHeadings, parseMarkdownHeadingBlocks } from "./markdownEditing";

describe("structured Markdown headings", () => {
  it("renumbers only numbered headings of the same rank under the same parent", () => {
    const source = [
      "# 8. Parent A",
      "## 7. Child A1",
      "## Unnumbered",
      "## 9. Child A2",
      "# Parent B",
      "## 4. Child B1",
      "### 8. Detail",
      "### 3. Detail 2",
    ].join("\n");
    expect(normalizeNumberedHeadings(source)).toBe([
      "# 1. Parent A",
      "## 1. Child A1",
      "## Unnumbered",
      "## 2. Child A2",
      "# Parent B",
      "## 1. Child B1",
      "### 1. Detail",
      "### 2. Detail 2",
    ].join("\n"));
  });

  it("ignores heading-like text in fenced code", () => {
    expect(normalizeNumberedHeadings("# 9. Real\n```md\n# 7. Code\n```\n# 3. Next"))
      .toBe("# 1. Real\n```md\n# 7. Code\n```\n# 2. Next");
  });

  it("moves a complete heading block before a same-parent sibling", () => {
    const source = "# Root\n## 1. First\nbody\n### Child\nchild body\n## 2. Second\nsecond body\n## 3. Third\n";
    const headings = parseMarkdownHeadingBlocks(source);
    const first = headings.find((heading) => heading.title === "First")!;
    const third = headings.find((heading) => heading.title === "Third")!;
    expect(moveHeadingBlock(source, first.start, third.start, "after")).toBe(
      "# Root\n## 1. Second\nsecond body\n## 2. Third\n## 3. First\nbody\n### Child\nchild body\n",
    );
  });

  it("rejects hierarchy changes", () => {
    const source = "# Root\n## Child\n### Detail\n# Other";
    const headings = parseMarkdownHeadingBlocks(source);
    expect(moveHeadingBlock(source, headings[1].start, headings[2].start, "before")).toBeNull();
    expect(moveHeadingBlock(source, headings[1].start, headings[3].start, "before")).toBeNull();
  });
});
