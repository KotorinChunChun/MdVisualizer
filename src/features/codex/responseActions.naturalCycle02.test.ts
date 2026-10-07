import { describe, expect, it } from "vitest";
import { hasCandidateImageReference, replaceCandidateImageReferences } from "./responseActions";

describe("B02 参照形式の候補コピーと通常リンクの境界", () => {
  const source = "data:image/png;base64,YQ==", output = "image/copied.png";
  it("画像専用の共有定義を一度だけ更新して参照形式・タイトル・前後文字を保つ", () => {
    const markdown = `前 ![一][image]\n\n[image]: <${source}> "説明"\n\n後 ![二][image]\n\n\`![例][image]\``;
    expect(hasCandidateImageReference(markdown, source)).toBe(true);
    expect(replaceCandidateImageReferences(markdown, source, output)).toBe(markdown.replace(`<${source}>`, `<${output}>`));
  });
  it("通常リンクと共用する定義は維持して画像出現だけコピー用ファイル参照にする", () => {
    const markdown = `![一][image]\n\n[通常リンク][image]\n\n![二][image]\n\n[image]: <${source}> "説明"`;
    expect(replaceCandidateImageReferences(markdown, source, output)).toBe(`![一](${output} "説明")\n\n[通常リンク][image]\n\n![二](${output} "説明")\n\n[image]: <${source}> "説明"`);
  });
  it("重複ラベルの最初の定義だけを解決し、コード例・未使用定義を採用扱いしない", () => {
    const markdown = `![one][IMAGE]\n\n[image]: other.png\n[image]: ${source}\n\n\`![fake][unused]\`\n\n[unused]: ${source}`;
    expect(hasCandidateImageReference(markdown, source)).toBe(false);
    expect(replaceCandidateImageReferences(markdown, source, output)).toBe(markdown);
  });
});
