import { describe, expect, it } from "vitest";
import { scopeRequest, targetAtLine } from "./scope";

describe("Codex相談の対象範囲", () => {
  const content = "前の文章\n\n```mermaid\nflowchart TD\nA --> B\n```\n\n後の文章";
  it("Mermaidのフェンスを含む指定ブロックだけを取得する", () => {
    const target = targetAtLine(content, 4)!;
    expect(content.slice(target.from, target.to)).toBe("```mermaid\nflowchart TD\nA --> B\n```");
  });
  it("段落内の明示選択だけを対象にし、曖昧な一致は推測しない", () => {
    expect(targetAtLine("前の文章", 1, "文章")).toEqual({ from: 2, to: 4 });
    expect(targetAtLine("同じ 同じ", 1, "同じ")).toBeNull();
    expect(targetAtLine("**太字**", 1, "別の文")).toBeNull();
  });
  it("画像の記法と添付元を特定する", () => {
    expect(targetAtLine("![図](test.png)", 1, "", true)).toEqual({ from: 0, to: 14, imageSource: "test.png" });
  });
  it("限定編集は前後を含めず、広域編集だけ文書全体を送る", () => {
    const snapshot = { documentId: "doc", content, from: 0, to: 0 };
    const target = { ...snapshot, ...targetAtLine(content, 4)! };
    expect(scopeRequest(snapshot, target, "selection", "直して").text).toBe(content.slice(target.from, target.to));
    const broad = scopeRequest(snapshot, target, "document", "直して");
    expect(broad.base).toEqual({ ...snapshot, to: content.length });
    expect(broad.text).toBe(content);
    expect(broad.instruction).toContain("別ファイルの編集は許可されていません");
    expect(scopeRequest(snapshot, target, "question", "説明して").instruction).toContain("replacementは必ずnull");
  });
});
