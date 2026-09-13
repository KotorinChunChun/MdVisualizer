import { describe, expect, it, vi } from "vitest";
import { imageInsertion, loadTranscriptionImage, transcriptionImages } from "./imageTranscription";
import { readDocumentAsset } from "../../lib/commands";
vi.mock("../../lib/commands", () => ({ readDocumentAsset: vi.fn() }));

describe("画像の解説挿入", () => {
  it("CRLF本文の行末を分断せず挿入する", () => {
    const content = "前文\r\n\r\n![a](a.png)\r\n後続";
    const edit = imageInsertion(content, transcriptionImages(content)[0], "説明\n文字");
    const result = content.slice(0, edit.from) + edit.replacement + content.slice(edit.to);
    expect(result).toContain("![a](a.png)\r\n\r\n```text\r\n説明\r\n文字\r\n```\r\n\r\n後続");
    expect(result.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
  it("同じ画像の2番目を選び、その直下だけへコードブロックを挿入する", () => {
    const content = "![a](a.png)\n\n![a](a.png)\n\n後続";
    const target = transcriptionImages(content)[1];
    const edit = imageInsertion(content, target, "解説\n```\n文字");
    const result = content.slice(0, edit.from) + edit.replacement + content.slice(edit.to);
    expect(result).toBe("![a](a.png)\n\n![a](a.png)\n\n````text\n解説\n```\n文字\n````\n\n\n後続");
  });
  it("コード内の画像を選択候補に含めない", () => {
    expect(transcriptionImages("```\n![a](a.png)\n```\n\n![b](b.png)")).toHaveLength(1);
  });
  it.each(["| ![a](a.png) |\n|---|", "> ![a](a.png)", "- ![a](a.png)", "[![a](a.png)](link)", "<div>\n<img src='a.png'>\n</div>"])("入れ子構文を壊す挿入を拒否: %s", (content) => {
    expect(() => imageInsertion(content, transcriptionImages(content)[0], "解説")).toThrow();
  });
  it("末尾のHTML画像にも挿入でき、空応答と古い位置は拒否する", () => {
    const content = '<img src="a.png">';
    const target = transcriptionImages(content)[0];
    expect(imageInsertion(content, target, "解説").from).toBe(content.length);
    expect(() => imageInsertion(content, target, " ")).toThrow();
    expect(() => imageInsertion("変更" + content, target, "解説")).toThrow();
  });
  it("埋め込み画像はファイルアクセスなしに添付する", async () => {
    expect(await loadTranscriptionImage("", "data:image/png;base64,YQ==")).toEqual({ base64: "YQ==", mime: "image/png" });
    expect(readDocumentAsset).not.toHaveBeenCalled();
  });
  it.each(["https://example.com/a.png", "file:///C:/a.png", "javascript:alert(1)", "data:image/svg+xml;base64,YQ==", "\\\\server\\a.png"])("許可しない参照は読み込まない: %s", async (source) => {
    await expect(loadTranscriptionImage("C:/test.md", source)).rejects.toThrow();
    expect(readDocumentAsset).not.toHaveBeenCalled();
  });
});
