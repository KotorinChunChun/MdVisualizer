import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { captionReplacement, resolveOperationTarget } from "../features/codex/scope";
import { collectEditableMarkdownOccurrences, replaceMarkdownOccurrence, type ImageMarkdownOccurrence } from "./markdownOccurrences";
import { replaceImageOccurrenceSource } from "./assetConversion";
import { escapePreviewInlineReplacement } from "./previewInlineEdit";

afterEach(cleanup);
const embedded = "data:image/png;base64,QUJD";
function images(markdown: string) { return collectEditableMarkdownOccurrences(markdown).filter((item): item is ImageMarkdownOccurrence => item.kind === "image"); }
function caption(markdown: string, value: string, index = 0): string {
  const image = images(markdown)[index];
  expect(image, "画像の出現箇所が存在する").toBeDefined();
  const target = { ...resolveOperationTarget(markdown, { offset: image.start })!, documentId: "natural-cycle-01" };
  return replaceMarkdownOccurrence(markdown, image, captionReplacement(target, value));
}
function source(markdown: string, value: string, index = 0) { return replaceImageOccurrenceSource(markdown, images(markdown)[index], value); }
function assertTable(markdown: string, expectedCaption: string) {
  const table = collectEditableMarkdownOccurrences(markdown).find(item => item.kind === "table");
  expect(table?.kind).toBe("table");
  if (table?.kind !== "table") throw new Error("表が消失した");
  expect(table.headers).toEqual(["図", "備考"]);
  expect(table.rows[0]).toHaveLength(2);
  expect(table.rows[0][1]).toBe("隣接セル");
  const view = render(<MarkdownPreview content={markdown} baseDir="C:/natural-cycle-01" imageVersions={{}} />);
  expect(view.container.querySelectorAll("img")).toHaveLength(1);
  expect(view.container.querySelector("img")?.alt).toBe(expectedCaption);
  expect([...view.container.querySelectorAll("td")].map(cell => cell.textContent)).toEqual([expectedCaption, "隣接セル"]);
  view.unmount();
}

describe("第1組 B01-C01〜C15 キャプションと画像変換", () => {
  it("B01-C01 表内のAIキャプションへ縦棒を入れても画像・列・隣接セルを保持する", () => {
    const original = "| 図 | 備考 |\n| --- | --- |\n| ![旧](same.png) | 隣接セル |";
    const changed = caption(original, "左 | 右");
    assertTable(changed, "左 | 右");
  });
  it("B01-C02 AIと手動のcaptionは強調・コード・打消し記号を文字として同じ値に保つ", () => {
    const value = "**重要** _下線_ `x=1` ~~廃止~~";
    const original = '![旧](same.png "title")';
    const changed = caption(original, value);
    expect(images(changed)[0].caption).toBe(value);
    const manual = `![${escapePreviewInlineReplacement(value, "image-alt")}](same.png "title")`;
    expect(images(changed)[0].caption).toBe(images(manual)[0].caption);
    expect(changed).toContain('(same.png "title")');
  });
  it("B01-C03 captionの実体参照らしい説明を勝手に復号しない", () => {
    const value = "HTMLの &amp; と &#65; は別の表記";
    const changed = caption("![旧](same.png)", value);
    expect(images(changed)[0].caption).toBe(value);
  });
  it("B01-C04 HTML画像captionの引用符・比較記号・ampersandでもsrc/titleを保持する", () => {
    const changed = caption('<img src="same.png" alt="旧" title="固定">', '図 "A&B" <比較> [1]');
    const view = document.createElement("div"); view.innerHTML = changed;
    expect(view.querySelector("img")?.alt).toBe('図 "A&B" <比較> [1]');
    expect(view.querySelector("img")?.getAttribute("src")).toBe("same.png");
    expect(view.querySelector("img")?.title).toBe("固定");
  });
  it("B01-C05 日本語・絵文字と全種の改行を1行captionとして保存する", () => {
    const changed = caption("![旧](same.png)", "日本語😺\r\n次\rその次\n最後");
    expect(changed).not.toMatch(/[\r\n]/);
    expect(images(changed)[0].caption).toBe("日本語😺 次 その次 最後");
  });
  it("B01-C06 同じ画像3配置の中央captionだけを変えて他のtitleとcaptionを維持する", () => {
    const original = '![左](same.png "L") ![中央](same.png "C") ![右](same.png "R")';
    expect(caption(original, "中央のみ", 1)).toBe('![左](same.png "L") ![中央のみ](same.png "C") ![右](same.png "R")');
  });
  it("B01-C07 captionを空欄へ戻しても画像とtitleを残す", () => {
    const changed = caption('![記入済](same.png "固定")', "");
    expect(changed).toBe('![](same.png "固定")');
    expect(images(changed)[0]).toMatchObject({ caption: "", source: "same.png" });
  });
  it("B01-C08 Wikiの括弧captionは通常画像記法へ移して文字と空白つき参照を保持する", () => {
    const changed = caption("![[folder/a b.png|旧]]", "説明 [完成]");
    expect(changed.startsWith("![[")).toBe(false);
    expect(images(changed)[0].caption).toBe("説明 [完成]");
    expect(decodeURIComponent(images(changed)[0].source)).toBe("folder/a b.png");
  });
  it("B01-C09 Wikiの数値captionを画像寸法として誤認しない", () => {
    const changed = caption("![[same.png|旧]]", "120x48");
    expect(changed).toBe("![120x48](same.png)");
    expect(images(changed)[0].caption).toBe("120x48");
  });
  it("B01-C10 Wikiの記号captionを付けて埋め込みへ変換しても文字を失わない", () => {
    const value = "**注目** `code` &amp;";
    const changed = caption("![[same.png|旧]]", value);
    expect(images(changed)[0].caption).toBe(value);
    expect(images(source(changed, embedded))[0].caption).toBe(value);
  });
  it("B01-C11 ファイルから埋込を経て特殊文字名ファイルへ戻してもcaption/titleを保つ", () => {
    const original = '![説明](old.png "固定")';
    const converted = source(original, embedded);
    const destination = "images/図 [1](完成).png";
    const restored = source(converted, destination);
    expect(images(restored)[0].caption).toBe("説明");
    expect(decodeURIComponent(images(restored)[0].source)).toBe(destination);
    expect(restored).toContain('"固定"');
  });
  it("B01-C12 HTML埋込画像をampersand入りファイル名へ変換して属性を保つ", () => {
    const original = `<img src="${embedded}" alt="A&amp;B" title="固定">`;
    const changed = source(original, "images/a&b.png");
    const view = document.createElement("div"); view.innerHTML = changed;
    expect(view.querySelector("img")?.getAttribute("src")).toBe("images/a&b.png");
    expect(view.querySelector("img")?.alt).toBe("A&B");
    expect(view.querySelector("img")?.title).toBe("固定");
  });
  it("B01-C13 表内の埋込画像をファイルと往復してcaptionの縦棒と表を維持する", () => {
    const original = `| 図 | 備考 |\n| --- | --- |\n| ![左\\|右](${embedded} "固定") | 隣接セル |`;
    const converted = source(original, "images/table.png");
    assertTable(converted, "左|右");
    const restored = source(converted, embedded);
    expect(restored).toBe(original);
    assertTable(restored, "左|右");
  });
  it("B01-C14 同じ画像3配置の中央だけを埋め込みにして他の画像を変更しない", () => {
    const original = '![左](same.png) ![中央](same.png) ![右](same.png)';
    const converted = source(original, embedded, 1);
    expect(converted).toBe(`![左](same.png) ![中央](${embedded}) ![右](same.png)`);
    expect(source(converted, "same.png", 1)).toBe(original);
  });
  it("B01-C15 caption変更後の古い対象による変換は拒否し再選択後は成功する", () => {
    const original = "![旧](same.png)";
    const stale = images(original)[0];
    const changed = caption(original, "新しい説明");
    expect(() => replaceImageOccurrenceSource(changed, stale, embedded)).toThrow();
    const converted = source(changed, embedded);
    expect(images(converted)[0]).toMatchObject({ caption: "新しい説明", source: embedded });
  });
});
