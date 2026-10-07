import { describe, expect, it } from "vitest";
import { resolveStagedImagePreview } from "./path";

describe("仮画像のURIと生ファイル名の境界", () => {
  it("一致しなかったURIを生ファイル名として再検索しない", () => {
    expect(resolveStagedImagePreview("a%20b.png", { "a%20b.png": "別画像" })).toBeUndefined();
  });
  it("一度復号後に一致しなくても二度目は復号しない", () => {
    expect(resolveStagedImagePreview("a%2520b.png", { "a b.png": "別画像" })).toBeUndefined();
  });
  it("和文と不正なUTF-8列が隣接しなければ和文だけ復号する", () => {
    expect(resolveStagedImagePreview("%E5%9B%B3-%FF.png", { "図-%FF.png": "仮画像" })).toBe("仮画像");
  });
  it("未登録のprototype属性を仮画像として返さない", () => {
    expect(resolveStagedImagePreview("constructor", {})).toBeUndefined();
    expect(resolveStagedImagePreview("__proto__", {})).toBeUndefined();
    expect(resolveStagedImagePreview("toString", {})).toBeUndefined();
  });
});
