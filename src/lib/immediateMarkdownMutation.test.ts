import { describe, expect, it } from "vitest";
import { collectEditableMarkdownOccurrences, MarkdownOccurrenceConflictError, type CodeFenceOccurrence } from "./markdownOccurrences";
import { relocateUnchangedOccurrence, replaceBestEffortOccurrence, replaceRelocatedOccurrence } from "./immediateMarkdownMutation";

describe("immediate Markdown mutation", () => {
  it("relocates an unchanged target after unrelated storage edits", () => {
    const originalText = "before\n\n```mermaid\nA --> B\n```";
    const original = collectEditableMarkdownOccurrences(originalText).find((item): item is CodeFenceOccurrence => item.kind === "code-fence")!;
    const latest = `new heading\n\n${originalText}`;

    const relocated = relocateUnchangedOccurrence(latest, original);
    expect(relocated.start).toBeGreaterThan(original.start);
    expect(replaceRelocatedOccurrence(latest, original, "![Mermaid](flow.mmd)")).toContain("![Mermaid](flow.mmd)");
  });

  it("rejects a target whose stored content changed", () => {
    const originalText = "```mermaid\nA --> B\n```";
    const original = collectEditableMarkdownOccurrences(originalText)[0];
    expect(() => relocateUnchangedOccurrence("```mermaid\nA --> C\n```", original)).toThrow(MarkdownOccurrenceConflictError);
  });

  it("起動時コードは位置と文字数が近い同種候補へ確定置換を反映する", () => {
    const current = "prefix\n```mermaid\nA --> B changed\n```";
    const original = collectEditableMarkdownOccurrences(current)[0];
    const opened = "```mermaid\nA --> B\n```\n\n```mermaid\nX --> Y\n```";
    expect(replaceBestEffortOccurrence(opened, original, "![Mermaid](flow.mmd)").startsWith("![Mermaid](flow.mmd)"))
      .toBe(true);
  });

  it("見出し付きコードフェンスも一つの確定範囲として再配置する", () => {
    const markdown = "### diagrams/flow.mmd\n\n```mermaid\nA --> B\n```";
    const native = collectEditableMarkdownOccurrences(markdown)[0] as CodeFenceOccurrence;
    const decorated = { ...native, start: 0, expected: markdown };
    expect(replaceRelocatedOccurrence(markdown, decorated, "![Mermaid](diagrams/flow.mmd)")).toBe("![Mermaid](diagrams/flow.mmd)");
  });

  it("同種候補がない場合は別種のMarkdown要素を誤置換しない", () => {
    const originalMarkdown = "```drawio\n<mxGraphModel/>\n```";
    const [original] = collectEditableMarkdownOccurrences(originalMarkdown);
    const markdownWithoutCodeFence = "![構成図](diagram.drawio)";

    expect(() => replaceBestEffortOccurrence(markdownWithoutCodeFence, original, "replacement"))
      .toThrow(MarkdownOccurrenceConflictError);
    expect(markdownWithoutCodeFence).toBe("![構成図](diagram.drawio)");
  });

  it("同じコードフェンスでも言語が異なる候補は誤置換しない", () => {
    const [original] = collectEditableMarkdownOccurrences("```drawio\n<mxGraphModel/>\n```");
    const mermaidOnly = "```mermaid\nflowchart LR\nA-->B\n```";

    expect(() => replaceBestEffortOccurrence(mermaidOnly, original, "replacement"))
      .toThrow(MarkdownOccurrenceConflictError);
  });

  it("同じ画像参照でも拡張子が異なる候補は誤置換しない", () => {
    const [original] = collectEditableMarkdownOccurrences("![](diagram.drawio)");
    const pngOnly = "![](diagram.png)";

    expect(() => replaceBestEffortOccurrence(pngOnly, original, "replacement"))
      .toThrow(MarkdownOccurrenceConflictError);
  });
});
