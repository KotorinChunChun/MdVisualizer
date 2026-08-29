import { describe, expect, it } from "vitest";
import { collectEditableMarkdownOccurrences, type CodeFenceOccurrence } from "./markdownOccurrences";
import { codeFencePathDecoration, embeddedFenceWithPath, markdownContinuationPrefix, splitFenceLanguagePath } from "./externalPathRepresentation";

const fence = (markdown: string) => collectEditableMarkdownOccurrences(markdown).find((item): item is CodeFenceOccurrence => item.kind === "code-fence")!;

describe("external path representation", () => {
  it.each([
    ["### src/main.ts\n\n```ts\ncode\n```", "heading"],
    ["**`src/main.ts`**\n\n```ts\ncode\n```", "bold-code"],
    ['```ts title="src/main.ts"\ncode\n```', "fence-title"],
    ["```ts:src/main.ts\ncode\n```", "fence-colon"],
  ] as const)("%s から相対パスを検出する", (markdown, style) => {
    const result = codeFencePathDecoration(markdown, fence(markdown));
    expect(result.relativePath).toBe("src/main.ts");
    expect(result.style).toBe(style);
    if (style === "heading" || style === "bold-code") expect(result.occurrence.start).toBe(0);
  });

  it("4方式の埋め込みコードを生成する", () => {
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "heading" })).toContain("### src/main.ts");
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "bold-code" })).toContain("**`src/main.ts`**");
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "fence-title" })).toContain('```ts title="src/main.ts"');
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "fence-colon" })).toContain("```ts:src/main.ts");
  });

  it("コロン記法から言語とパスを分離する", () => {
    expect(splitFenceLanguagePath("mermaid:diagrams/flow.mmd")).toEqual({ language: "mermaid", relativePath: "diagrams/flow.mmd" });
  });

  it.each([
    ["> ### src/main.ts\n>\n> ```ts\n> code\n> ```", "> "],
    ["- ### src/main.ts\n  \n  ```ts\n  code\n  ```", "  "],
  ] as const)("入れ子の見出し表現を検出して構造上の接頭辞を維持する", (markdown, prefix) => {
    const occurrence = fence(markdown);
    const decoration = codeFencePathDecoration(markdown, occurrence);
    expect(decoration.relativePath).toBe("src/main.ts");
    expect(decoration.style).toBe("heading");
    expect(markdownContinuationPrefix(markdown, decoration.occurrence.start)).toBe(prefix);
  });
});
