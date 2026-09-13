import { describe, expect, it } from "vitest";
import { collectEditableMarkdownOccurrences, type CodeFenceOccurrence } from "./markdownOccurrences";
import { appendFilenameExtension, codeFencePathDecoration, embeddedFenceWithPath, markdownContinuationPrefix, removeFilenameExtension, splitFenceLanguagePath } from "./externalPathRepresentation";

const fence = (markdown: string) => collectEditableMarkdownOccurrences(markdown).find((item): item is CodeFenceOccurrence => item.kind === "code-fence")!;

describe("external path representation", () => {
  it.each(["\n", "\r\n", "\r"])("先頭の空行を含むコードフェンスを有限時間で処理する（%j）", (ending) => {
    for (const leading of [ending, ending.repeat(2), `${ending}  ${ending}`, `${ending}> ${ending}`]) {
      const markdown = `${leading}\`\`\`svg${ending}<svg xmlns="http://www.w3.org/2000/svg"/>${ending}\`\`\``;
      const occurrence = fence(markdown);
      const result = codeFencePathDecoration(markdown, occurrence);
      expect(result.relativePath).toBeUndefined();
      expect(result.occurrence).toBe(occurrence);
    }
  });

  it("空行より前の先頭行にあるファイル名は引き続き検出する", () => {
    const markdown = "### src/main.ts\n\n\n```ts\ncode\n```";
    expect(codeFencePathDecoration(markdown, fence(markdown)).relativePath).toBe("src/main.ts");
  });
  it.each([
    ["### src/main.ts — Main flow\n\n```ts\ncode\n```", "heading"],
    ["**`src/main.ts - Main flow`**\n\n```ts\ncode\n```", "bold-code"],
    ['```ts title="src/main.ts" alt="Main flow"\ncode\n```', "fence-title"],
    ["```ts:src/main.ts - Main flow\ncode\n```", "fence-colon"],
  ] as const)("%s から相対パスを検出する", (markdown, style) => {
    const result = codeFencePathDecoration(markdown, fence(markdown));
    expect(result.relativePath).toBe("src/main.ts");
    expect(result.alt).toBe("Main flow");
    expect(result.style).toBe(style);
    if (style === "heading" || style === "bold-code") expect(result.occurrence.start).toBe(0);
  });

  it("4方式の埋め込みコードを生成する", () => {
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "heading" })).toContain("### src/main");
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "bold-code" })).toContain("**`src/main`**");
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "fence-title" })).toContain('```ts title="src/main"');
    expect(embeddedFenceWithPath({ language: "ts", body: "code", relativePath: "src/main.ts", style: "fence-colon" })).toContain("```ts:src/main");
  });

  it("alt付きの4方式を指定どおり生成する", () => {
    expect(embeddedFenceWithPath({ language: "drawio", body: "xml", relativePath: "diagram.drawio", alt: "構成図", style: "heading" })).toContain("### diagram — 構成図");
    expect(embeddedFenceWithPath({ language: "mermaid", body: "flow", relativePath: "diagram.mmd", alt: "処理フロー", style: "bold-code" })).toContain("**`diagram - 処理フロー`**");
    expect(embeddedFenceWithPath({ language: "drawio", body: "xml", relativePath: "diagram.drawio", alt: "構成図", style: "fence-title" })).toContain('```drawio title="diagram" alt="構成図"');
    expect(embeddedFenceWithPath({ language: "mermaid", body: "flow", relativePath: "diagram.mmd", alt: "処理フロー", style: "fence-colon" })).toContain("```mermaid:diagram - 処理フロー");
  });

  it("altなしの4方式は拡張子なしのファイル名だけを生成する", () => {
    expect(embeddedFenceWithPath({ language: "drawio", body: "xml", relativePath: "diagram.drawio", style: "heading" })).toContain("### diagram\n");
    expect(embeddedFenceWithPath({ language: "mermaid", body: "flow", relativePath: "diagram.mmd", style: "bold-code" })).toContain("**`diagram`**");
    expect(embeddedFenceWithPath({ language: "drawio", body: "xml", relativePath: "diagram.drawio", style: "fence-title" })).toContain('```drawio title="diagram"');
    expect(embeddedFenceWithPath({ language: "mermaid", body: "flow", relativePath: "diagram.mmd", style: "fence-colon" })).toContain("```mermaid:diagram\n");
  });

  it("拡張子をファイル名の末尾だけで除去・付与する", () => {
    expect(removeFilenameExtension("src/main.ts")).toBe("src/main");
    expect(removeFilenameExtension("src/.main")).toBe("src/.main");
    expect(appendFilenameExtension("src/main", "ts")).toBe("src/main.ts");
    expect(appendFilenameExtension("src/main.js", ".ts")).toBe("src/main.ts");
  });

  it("コロン記法から言語とパスを分離する", () => {
    expect(splitFenceLanguagePath("mermaid:diagrams/flow.mmd - 処理フロー")).toEqual({ language: "mermaid", relativePath: "diagrams/flow.mmd", alt: "処理フロー" });
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

  it("拡張子なしの直前の見出し・太字インラインコードを候補として検出する", () => {
    const headingMarkdown = "### src/main\n\n```ts\ncode\n```";
    const boldMarkdown = "**`src/main`**\n\n```ts\ncode\n```";
    expect(codeFencePathDecoration(headingMarkdown, fence(headingMarkdown)).relativePath).toBe("src/main");
    expect(codeFencePathDecoration(boldMarkdown, fence(boldMarkdown)).relativePath).toBe("src/main");
  });

  it("見出し・太字インラインコードとコードブロックの間に文章があれば候補にしない", () => {
    const headingMarkdown = "### src/main\n\n説明文\n\n```ts\ncode\n```";
    const boldMarkdown = "**`src/main`**\n\n説明文\n\n```ts\ncode\n```";
    expect(codeFencePathDecoration(headingMarkdown, fence(headingMarkdown)).relativePath).toBeUndefined();
    expect(codeFencePathDecoration(boldMarkdown, fence(boldMarkdown)).relativePath).toBeUndefined();
  });
});
