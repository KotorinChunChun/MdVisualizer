import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPreviewSelection, previewClipboardData, previewPlainText } from "./previewClipboard";

afterEach(() => { document.body.innerHTML = ""; window.getSelection()?.removeAllRanges(); });
describe("プレビューのコピー", () => {
  it("キーのSVGを単一文字列にして段落の改行だけ残す", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p>押す <span><svg data-shortcut-source="Ctrl+X → Ctrl+V"><text>Ctrl</text><text>+</text><text>X</text></svg></span></p><p>次の段落</p>';
    expect(previewPlainText(root)).toBe("押す Ctrl + X → Ctrl + V\n次の段落");
  });
  it("Ctrl+Cと右クリックのMarkdown取得を一致させる", () => {
    const root = document.createElement("div"); document.body.append(root);
    root.innerHTML = '<h2 data-source-line="1">見出し</h2><p data-source-line="3"><strong>本文</strong></p>';
    const content = "## 見出し\n\n**本文**";
    const p = root.querySelector("p")!;
    const range = document.createRange(); range.selectNodeContents(p); window.getSelection()!.addRange(range);
    const clipboardData = { setData: vi.fn() };
    const preventDefault = vi.fn();
    copyPreviewSelection({ target: p, currentTarget: root, clipboardData: clipboardData as unknown as DataTransfer, preventDefault }, content);
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", previewClipboardData(root, content, p).markdownText);
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "**本文**");
    expect(preventDefault).toHaveBeenCalledOnce();
  });
  it("入力欄や選択がない場合のコピーを横取りしない", () => {
    const root = document.createElement("div"); root.innerHTML = '<textarea>入力</textarea>';
    const preventDefault = vi.fn();
    copyPreviewSelection({ target: root.firstChild!, currentTarget: root, clipboardData: {} as DataTransfer, preventDefault }, "入力");
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
