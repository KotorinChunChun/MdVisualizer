import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { compactEmbeddedImages } from "./compactEmbeddedImages";
describe("埋め込み画像の構文解析用短縮", () => {
  it.each(["\n", "\r\n", "\r"])("元のASTとURL・テキスト・位置を完全に一致させる: %j", newline => {
    const data = "YWJj".repeat(4096);
    const source = ["# 😀見出し",`![説明](data:image/png;base64,${data}) 後の文`, `![二枚目](data:image/png;base64,${data})`,"```text",`data:image/png;base64,${data}`,"```",`<img src="data:image/png;base64,${data}" alt="HTML">`,"末尾"].join(newline);
    const parser = unified().use(remarkParse).use(remarkGfm);
    const compact = compactEmbeddedImages(source);
    expect(compact.markdown.length).toBeLessThan(1000);
    const actual = parser.parse(compact.markdown); compact.restore(actual);
    expect(actual).toEqual(parser.parse(source));
  });
  it("既存のtoken文字列と衝突せず短い画像と改行Base64を変更しない", () => {
    const source = `MdVisualizerImagePayload0End\n![x](data:image/png;base64,${"AA".repeat(2048)})\n![s](data:image/png;base64,YWJj)`;
    const compact = compactEmbeddedImages(source); const parser=unified().use(remarkParse);const actual=parser.parse(compact.markdown);compact.restore(actual);
    expect(actual).toEqual(parser.parse(source));
  });
});
