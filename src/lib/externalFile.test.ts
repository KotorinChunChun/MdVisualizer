import { describe, expect, it } from "vitest";
import { compactExternalFilename, rebaseRenamedExternalReferences, replaceExternalSourceFilename, splitExternalFilename, validateExternalFilename } from "./externalFile";

describe("externalFile", () => {
  it("長いファイル名を冒頭10文字と末尾5文字へ省略する", () => {
    expect(compactExternalFilename("1234567890abcdefghij.png")).toBe("1234567890.....j.png");
  });

  it("使用禁止文字と末尾空白を拒否する", () => {
    expect(validateExternalFilename("bad:name.png")).toContain("使用できない文字");
    expect(validateExternalFilename("bad.png ")).toContain("末尾");
    expect(validateExternalFilename("good.png")).toBeNull();
  });

  it("参照元のフォルダーとクエリを保ったままファイル名を置換する", () => {
    expect(replaceExternalSourceFilename("images/old.png?raw=1", "new.png")).toBe("images/new.png?raw=1");
  });

  it("対象ファイルへの画像参照だけを未保存Markdownへ反映する", () => {
    const markdown = "![対象](images/old.png)\n![別](images/other.png)";
    expect(rebaseRenamedExternalReferences(markdown, "C:/docs", "C:/docs/images/old.png", "new.png"))
      .toBe("![対象](images/new.png)\n![別](images/other.png)");
  });

  it("Obsidian形式のMermaid参照も未保存Markdownへ反映する", () => {
    const markdown = "![[images/old.mmd|処理フロー]]\n![[images/other.mmd|別図]]";
    expect(rebaseRenamedExternalReferences(markdown, "C:/docs", "C:/docs/images/old.mmd", "new.mmd"))
      .toBe("![[images/new.mmd|処理フロー]]\n![[images/other.mmd|別図]]");
  });

  it("名称編集用に拡張子を分離する", () => {
    expect(splitExternalFilename("report.final.csv")).toEqual({ stem: "report.final", extension: ".csv" });
    expect(splitExternalFilename("README")).toEqual({ stem: "README", extension: "" });
  });
});
