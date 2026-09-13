import { describe, expect, it } from "vitest";
import { bindRenderedPreviewInlineEditLeaves, collectPreviewInlineEditLeaves, escapePreviewInlineReplacement } from "./previewInlineEdit";

describe("preview inline edit ranges", () => {
  it("keeps Markdown scaffolding outside editable text ranges", () => {
    const source = "# 見出し\r\n\r\n- **太字** と [リンク](https://example.test) と `code`\r\n\r\n![写真](photo.png \"title\")";
    const leaves = collectPreviewInlineEditLeaves(source);
    expect(leaves.map(leaf => [leaf.kind, source.slice(leaf.from, leaf.to)])).toEqual(expect.arrayContaining([
      ["text", "見出し"], ["text", "太字"], ["text", "リンク"], ["inline-code", "code"], ["image-alt", "写真"],
    ]));
    const link = leaves.find(leaf => leaf.value === "リンク")!;
    expect(source.slice(0, link.from) + "変更" + source.slice(link.to)).toContain("[変更](https://example.test)");
  });

  it("uses UTF-16 ranges for repeated Japanese and emoji text", () => {
    const source = "同じ😀 同じ😀";
    const leaves = collectPreviewInlineEditLeaves(source);
    expect(leaves).toHaveLength(1);
    expect(source.slice(leaves[0]!.from, leaves[0]!.to)).toBe(source);
  });

  it("escapes structural input without changing its surrounding syntax", () => {
    expect(escapePreviewInlineReplacement("**見出し** [x](y)", "text")).toBe("\\*\\*見出し\\*\\* \\[x\\](y)");
    expect(escapePreviewInlineReplacement("plain", "inline-code")).toBe("plain");
    expect(escapePreviewInlineReplacement("&amp;", "text")).toBe("&amp;amp;");
  });

  it("keeps escaped and nested brackets inside image ALT ranges", () => {
    const source = "![a\\] [b]](photo.png \"title\")";
    const image = collectPreviewInlineEditLeaves(source).find(leaf => leaf.kind === "image-alt")!;
    expect(source.slice(image.from, image.to)).toBe("a\\] [b]");
  });

  it("refuses a backquote in inline code rather than producing invalid Markdown", () => {
    expect(() => escapePreviewInlineReplacement("a`b", "inline-code")).toThrow(/バッククォート/);
  });

  it("does not bind leaves when rendering normalization changes their semantic order", () => {
    expect(bindRenderedPreviewInlineEditLeaves("one **two**", "two one")).toEqual([]);
  });
});
