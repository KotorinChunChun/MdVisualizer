import { describe, expect, it, vi } from "vitest";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { assertPreviewActionBindings, requiredPreviewActions } from "./previewActionContract";

describe("形式ごとの必須操作", () => {
  const cases = [
    ["```svg\n<svg/>\n```", ["onCodeFenceBodyChange", "onTextStorageConvert"]],
    ["```tsv\nA\tB\n```", ["onCodeFenceBodyChange", "onTableStorageConvert"]],
    ["```drawio\n<mxfile/>\n```", ["onCodeFenceBodyChange", "onDrawioStorageConvert"]],
    ["```mermaid\ngraph TD;A-->B\n```", ["onCodeFenceBodyChange", "onMermaidStorageConvert"]],
    ["```markdown\n# text\n```", ["onCodeFenceBodyChange", "onTextStorageConvert"]],
    ["| A |\n| --- |\n| B |", ["onMarkdownTableChange"]],
    ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', ["onInlineSvgChange", "onAssetStorageConvert"]],
    ["![図](image.svg)", ["onAssetStorageConvert"]],
    ["![表](table.tsv)", ["onExternalTableChange", "onTableStorageConvert"]],
  ] as const;
  for (const [content, expected] of cases) it(content, () => {
    const items = collectEditableMarkdownOccurrences(content);
    expect(items).toHaveLength(1);
    expect(requiredPreviewActions(items[0], "desktop")).toEqual(expected);
    const bindings = Object.fromEntries(expected.map(key => [key, vi.fn()]));
    expect(() => assertPreviewActionBindings(items, "desktop", bindings)).not.toThrow();
    for (const key of expected) expect(() => assertPreviewActionBindings(items, "desktop", { ...bindings, [key]: undefined })).toThrow(key);
  });
  it("Webの未対応SVG変換とリモート画像を未接続エラーにしない", () => {
    const items = collectEditableMarkdownOccurrences('![図](image.svg)\n\n![遠隔](https://example.test/image.svg)');
    expect(() => assertPreviewActionBindings(items, "web", {})).not.toThrow();
  });
});
