import { describe, expect, it } from "vitest";
import cases from "../../tests/fixtures/natural-cycle03-menu/cases.json";
import { rebaseRenamedExternalReferences } from "./externalFile";
import { collectEditableMarkdownOccurrences, replaceMarkdownOccurrence } from "./markdownOccurrences";
import { embeddedFenceWithPath, markdownContinuationPrefix } from "./externalPathRepresentation";
import { textExternalReference } from "./textStorage";
import { analyzeMarkdown } from "./markdownAnalysis";

describe("第3組メニュー: 参照更新とコンテナー保持（実App/Rustは別受入）", () => {
  it("B03-M01 参照型と通常画像が共有する実体の改名で全画像参照を更新しコード例は保つ", () => {
    const source = cases.M01.markdown;
    const next = rebaseRenamedExternalReferences(source, "C:/b03/M01", "C:/b03/M01/images/photo.png", cases.M01.renamedFilename);
    const images = collectEditableMarkdownOccurrences(next).filter(item => item.kind === "image");
    expect(images.map(item => ({ source: item.source, caption: item.caption }))).toEqual([
      { source: "images/renamed.png", caption: "左" },
      { source: "images/renamed.png", caption: "右" },
      { source: "images/renamed.png", caption: "通常" },
    ]);
    expect(next).toContain('"共通説明"');
    expect(next).toContain("`images/photo.png`");
    // ここでは下書きの参照変換だけ。Rust改名・保存本文の解析結果はnativeで別確認する。
  });

  it("B03-M06 リスト内の外部コードを埋込と往復してコード本文と兄弟項目を保持する", () => {
    const fixture = cases.M06;
    const occurrence = collectEditableMarkdownOccurrences(fixture.markdown)[0];
    if (occurrence.kind !== "image") throw new Error("外部コードfixtureが不正");
    const embedded = embeddedFenceWithPath({ language: "python", body: fixture.externalText, relativePath: fixture.source, style: "fence-title", continuationPrefix: markdownContinuationPrefix(fixture.markdown, occurrence.start) });
    const next = replaceMarkdownOccurrence(fixture.markdown, occurrence, embedded);
    const tree = analyzeMarkdown(next);
    expect.soft(tree.children.map(node => node.type), next).toEqual(["list"]);
    const list = tree.children[0];
    if (list.type !== "list") throw new Error("変換後の先頭がlistでない");
    expect.soft(list.children).toHaveLength(2);
    const firstCode = list.children[0].children.find(node => node.type === "code");
    expect.soft(firstCode?.type === "code" ? firstCode.value : undefined, next).toBe(fixture.externalText);
    const fence = collectEditableMarkdownOccurrences(next).find(item => item.kind === "code-fence");
    expect(fence?.kind).toBe("code-fence");
    if (fence?.kind !== "code-fence") return;
    expect.soft(fence.body).toBe(fixture.externalText);
    const restored = replaceMarkdownOccurrence(next, fence, textExternalReference(fixture.source));
    expect.soft(restored).toBe(fixture.markdown);
    // Appが呼ぶ同じ組立/置換helperを使う。実外部ファイルの読書きは別境界。
  });
});
