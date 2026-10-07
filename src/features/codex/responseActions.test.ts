import { describe, expect, it } from "vitest";
import { changedMarkdown, compactImageData, hasCandidateImageReference, replaceCandidateImageReferences, responseProposal } from "./responseActions";
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
  it.each([
    ['文章に image/a.png', false],
    ['`![](image/a.png)`', false],
    ['```md\n![](image/a.png)\n```', false],
    ['<!-- ![](image/a.png) -->', false],
    ['[未使用]: image/a.png', false],
    ['![説明][画像]\n\n[画像]: image/a.png', true],
    ['![画像]\n\n[画像]: image/a.png', true],
    ['![説明][画像]\n\n[画像]: other.png\n[画像]: image/a.png', false],
    ['<img src="image/a.png" alt="説明">', true],
  ])("候補の画像参照を構文で判定する: %s", (markdown, expected) => {
    expect(hasCandidateImageReference(markdown, 'image/a.png')).toBe(expected);
  });
  it("コピー用ファイルへの置換は画像参照だけを更新し、本文・alt・title・コード例を保持する", () => {
    const source = 'data:image/png;base64,bmV3';
    const text = `本文 ${source}\n![${source}](${source} "${source}")\n\n\`![](${source})\`\n\n![参照][a]\n\n[a]: <${source}> "説明"`;
    expect(replaceCandidateImageReferences(text, source, 'image/new.png')).toBe(`本文 ${source}\n![${source}](image/new.png "${source}")\n\n\`![](${source})\`\n\n![参照][a]\n\n[a]: <image/new.png> "説明"`);
  });
  it.each([
    '<div>\n<!-- <img src="image/new.png"> -->\n</div>',
    '<div>\n<!--\n<img src="image/new.png">\n-->\n</div>',
    '<div>\n<script>const example = \'<img src="image/new.png">\';</script>\n</div>',
    '<div>\n<pre><img src="image/new.png"></pre>\n</div>',
    '<div title=\'<img src="image/new.png">\'>説明</div>',
    '<img title=\'src="image/new.png"\'>',
  ])("HTML内のコメント・コードは候補判定と置換のどちらからも除外する: %s", markdown => {
    expect(hasCandidateImageReference(markdown, "image/new.png")).toBe(false);
    expect(replaceCandidateImageReferences(markdown, "image/new.png", "image/copied.png")).toBe(markdown);
  });
  it("HTML内の実画像だけを置換し、前後のコメントは元のまま残す", () => {
    const markdown = '<div>\n<!-- <img src="image/new.png"> -->\n<img src="image/new.png" alt="実画像">\n<!-- <img src="image/new.png"> -->\n</div>';
    expect(hasCandidateImageReference(markdown, "image/new.png")).toBe(true);
    expect(replaceCandidateImageReferences(markdown, "image/new.png", "image/copied.png"))
      .toBe(markdown.replace('<img src="image/new.png" alt=', '<img src="image/copied.png" alt='));
  });
});
