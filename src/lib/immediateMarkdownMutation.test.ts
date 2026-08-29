import { describe, expect, it } from "vitest";
import { collectEditableMarkdownOccurrences, MarkdownOccurrenceConflictError, type CodeFenceOccurrence } from "./markdownOccurrences";
import { relocateUnchangedOccurrence, replaceRelocatedOccurrence } from "./immediateMarkdownMutation";

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
});
