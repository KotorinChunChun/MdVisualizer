import { describe, expect, it } from "vitest";
import { detectLineEnding, normalizeLineEndings } from "./markdownEditing";

describe("Markdown改行コード", () => {
  it("文書内で最も多い改行コードを推測する", () => {
    expect(detectLineEnding("one\r\ntwo\nthree\r\nfour")).toBe("\r\n");
    expect(detectLineEnding("one\ntwo\r\nthree\nfour")).toBe("\n");
    expect(detectLineEnding("one\rtwo\nthree\rfour")).toBe("\r");
  });

  it("同数の場合は文書内で最初に現れた改行コードを採用する", () => {
    expect(detectLineEnding("one\ntwo\r\nthree")).toBe("\n");
    expect(detectLineEnding("one\r\ntwo\nthree")).toBe("\r\n");
  });

  it("改行がない文書ではLFを既定にする", () => {
    expect(detectLineEnding("single line")).toBe("\n");
  });

  it("CRLF、LF、CRの混在を指定形式へ統一する", () => {
    const mixed = "one\r\ntwo\nthree\rfour";
    expect(normalizeLineEndings(mixed, "\r\n")).toBe("one\r\ntwo\r\nthree\r\nfour");
    expect(normalizeLineEndings(mixed, "\n")).toBe("one\ntwo\nthree\nfour");
  });
});
