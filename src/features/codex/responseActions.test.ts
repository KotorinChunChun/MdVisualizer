import { describe, expect, it } from "vitest";
import { changedMarkdown, compactImageData, responseProposal } from "./responseActions";
const content = "見出し\n前半 対象 後半\n末尾";
const target = { documentId: "tab:1", content, from: 7, to: 9 };
describe("応答の挿入候補", () => {
  it("前後は対象行、置換は正確な範囲、カーソルは操作時点を使う", () => {
    expect(responseProposal(target, target, "応答", "before")).toBe("見出し\n応答\n前半 対象 後半\n末尾");
    expect(responseProposal(target, target, "応答", "after")).toBe("見出し\n前半 対象 後半\n応答\n末尾");
    expect(responseProposal(target, target, "応答", "replace")).toBe(content.slice(0, 7) + "応答" + content.slice(9));
    expect(responseProposal({ ...target, from: content.length, to: content.length }, target, "応答", "cursor")).toBe(content + "\n応答");
  });
  it("無選択の対象は全文の前後を使い、異なる本文を拒否する", () => {
    const all = { ...target, from: 0, to: content.length };
    expect(responseProposal(target, all, "応答", "before")).toBe("応答\n" + content);
    expect(responseProposal(target, all, "応答", "after")).toBe(content + "\n応答");
    expect(() => responseProposal({ ...target, content: content + "変更" }, target, "応答", "replace")).toThrow("変わりました");
  });
  it("表・リスト・フェンスを壊さず変化したブロックを残す", () => {
    const prefix = "共通\n\n\n\n\n";
    const before = prefix + "```js\nconst a = 1;\n```\n\n共通末尾";
    const after = before.replace("a = 1", "a = 2");
    const [a, b] = changedMarkdown(before, after);
    expect(a).toContain("```js\nconst a = 1;\n```");
    expect(b).toContain("```js\nconst a = 2;\n```");
    expect(a).not.toMatch(/^共通/);
  });
  it("コード比較の画像データを折り畳む", () => {
    expect(compactImageData("![](data:image/png;base64,AAAA)")).toBe("![](data:image/png;base64,[画像データ 3 bytes])");
  });
});
