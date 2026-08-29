import { describe, expect, it } from "vitest";
import { sourceExtensionForLanguage, textExternalReference } from "./textStorage";

describe("text storage", () => {
  it.each([
    ["typescript", "ts"],
    ["rust", "rs"],
    ["PowerShell", "ps1"],
    ["unknown-lang", "unknownlang"],
    ["", "txt"],
  ])("%s の外部ファイル拡張子を決定する", (language, extension) => {
    expect(sourceExtensionForLanguage(language)).toBe(extension);
  });

  it("相対パスをMarkdown画像参照として安全に組み立てる", () => {
    expect(textExternalReference("src/index.ts")).toBe("![index.ts](src/index.ts)");
    expect(textExternalReference("source files/main.ts")).toBe("![main.ts](<source files/main.ts>)");
  });
});
