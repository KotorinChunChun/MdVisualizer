import { describe, expect, it } from "vitest";
import { analyzeMarkdown } from "./markdownAnalysis";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { collectImageOccurrences } from "./imageOccurrences";
import { bindRenderedPreviewInlineEditLeaves } from "./previewInlineEdit";

describe("共有Markdown解析", () => {
  it("同じ本文の解析結果を再利用し、編集後の本文と混同しない", () => {
    const source = "# cache identity\n\n![説明](x.png)";
    const first = analyzeMarkdown(source);
    expect(analyzeMarkdown(source)).toBe(first);
    expect(analyzeMarkdown(source.replace("説明", "変更"))).not.toBe(first);
  });
  it("GFMとObsidianの構文契約を分離する", () => {
    const source = "![[photo.png|説明]]\n\n|a|b|\n|-|-|\n|1|2|";
    expect(analyzeMarkdown(source, "gfm")).not.toBe(analyzeMarkdown(source, "gfm-obsidian"));
    expect(collectImageOccurrences(source, "")[0]?.caption).toBe("説明");
    expect(collectEditableMarkdownOccurrences(source).some(item => item.kind === "table")).toBe(true);
  });
  it("画像の連続利用でもソース位置と内容を保持する", () => {
    const source = `本文😀\n\n![説明](data:image/png;base64,${"YWJj".repeat(10000)})\n\n終わり`;
    const first = collectEditableMarkdownOccurrences(source);
    bindRenderedPreviewInlineEditLeaves(source, source);
    collectImageOccurrences(source, "");
    expect(collectEditableMarkdownOccurrences(source)).toEqual(first);
    expect(source.slice(first[0]!.start, first[0]!.end)).toBe(first[0]!.expected);
  });
  it("多数の旧本文を保持せず古い解析を破棄する", () => {
    const source = "cache eviction source";
    const tree = analyzeMarkdown(source);
    for (let index = 0; index < 8; index++) analyzeMarkdown(`cache eviction ${index}`);
    expect(analyzeMarkdown(source)).not.toBe(tree);
  });
});
