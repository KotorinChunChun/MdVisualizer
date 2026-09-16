import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPreviewSelection, hasPrecisePreviewTextSelection, previewClipboardData, previewPlainText } from "./previewClipboard";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function selectContents(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("プレビューのコピー", () => {
  it("キーのSVGを単一文字列にして段落の改行だけ残す", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p>押す <span><svg data-shortcut-source="Ctrl+X → Ctrl+V"><text>Ctrl</text><text>+</text><text>X</text></svg></span></p><p>次の段落</p>';
    expect(previewPlainText(root)).toBe("押す Ctrl + X → Ctrl + V\n次の段落");
  });

  it("Ctrl+Cと右クリックのMarkdown取得を一致させる", () => {
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = '<h2 data-source-line="1">見出し</h2><p data-source-line="3"><strong>本文</strong></p>';
    const content = "## 見出し\n\n**本文**";
    const p = root.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()!.addRange(range);
    const clipboardData = { setData: vi.fn() };
    const preventDefault = vi.fn();
    copyPreviewSelection({ target: p, currentTarget: root, clipboardData: clipboardData as unknown as DataTransfer, preventDefault }, content);
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", previewClipboardData(root, content, p).markdownText);
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "**本文**");
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("入力欄や選択がない場合のコピーを横取りしない", () => {
    const root = document.createElement("div");
    root.innerHTML = "<textarea>入力</textarea>";
    const preventDefault = vi.fn();
    copyPreviewSelection({ target: root.firstChild!, currentTarget: root, clipboardData: {} as DataTransfer, preventDefault }, "入力");
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("見出しの選択を配下の本文まで拡張しない", () => {
    const root = document.createElement("div");
    root.innerHTML = "<section><h2>見出し</h2><p>選択していない本文</p></section>";
    document.body.append(root);

    selectContents(root.querySelector("h2")!);

    expect(hasPrecisePreviewTextSelection(root, window.getSelection())).toBe(true);
  });

  it("表のセル選択を表全体のコピーに置き換えない", () => {
    const root = document.createElement("div");
    root.innerHTML = "<table><tbody><tr><td>選択セル</td><td>別セル</td></tr></tbody></table>";
    document.body.append(root);

    selectContents(root.querySelector("td")!);

    expect(hasPrecisePreviewTextSelection(root, window.getSelection())).toBe(true);
  });
});
