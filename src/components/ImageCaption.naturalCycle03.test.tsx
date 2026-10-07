import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import cases from "../../tests/fixtures/natural-cycle03-menu/cases.json";
import { MarkdownPreview } from "./MarkdownPreview";
import { MediaPreviewModal, type MediaPreviewTarget } from "./MediaPreviewModal";
import { collectEditableMarkdownOccurrences } from "../lib/markdownOccurrences";
import { createImageCaptionSaver } from "../lib/imageCaptionSave";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("第3組メニュー: captionの保存・取消とコピー", () => {
  it("保存済み情報の再取得中は古いcaptionのコピーと変換を無効にし、取得後は元の並びで再操作できる", () => {
    const original = collectEditableMarkdownOccurrences(cases.M04.markdown)[0];
    if (original.kind !== "image") throw new Error("fixture");
    const convert = vi.fn(); const clipboard = vi.fn(); Object.assign(navigator, { clipboard: { writeText: clipboard } });
    const props = { content: { kind: "image" as const, src: "asset://original.png", alt: cases.M04.captionBefore }, onClose: vi.fn(),
      conversionContext: { documentPath: "C:/b03/note.md", occurrence: original, storage: "external" as const, assetKind: "raster" as const }, onConvertAsset: convert };
    const view = render(<MediaPreviewModal {...props} imageContextStale />);
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    for (const name of ["コードをMarkdownでコピー", "画像の説明文をコピー", "埋め込みに変換"]) {
      if (!screen.queryByRole("button", { name })) fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true); expect(button.title).toContain("確認中"); fireEvent.click(button);
    }
    expect(clipboard).not.toHaveBeenCalled(); expect(convert).not.toHaveBeenCalled();
    view.rerender(<MediaPreviewModal {...props} imageContextStale={false} />);
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    expect((screen.getByRole("button", { name: "コードをMarkdownでコピー" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "埋め込みに変換" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("B03-M04 画像情報の保存失敗は入力を保持し再保存後の説明とMarkdownコピーを更新する", async () => {
    const initial = cases.M04.markdown;
    const found = collectEditableMarkdownOccurrences(initial)[0];
    if (found.kind !== "image") throw new Error("画像fixture不正");
    const occurrence = found;
    let stored = initial;
    let resolveSave!: () => void;
    const save = vi.fn().mockRejectedValueOnce(new Error("試験用caption保存失敗")).mockImplementationOnce(() => new Promise<void>(resolve => { resolveSave = resolve; }));
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    const convert = vi.fn().mockResolvedValue(undefined);
    let current: MediaPreviewTarget = { content: { kind: "image", src: "asset://original.png", alt: cases.M04.captionBefore },
      imageContext: { markdownPath: "C:/b03/M04/note.md", imagePath: "C:/b03/M04/original.png", source: "original.png", sourceOffset: occurrence.start, caption: cases.M04.captionBefore },
      conversionContext: { documentPath: "C:/b03/M04/note.md", occurrence, storage: "external", assetKind: "raster" } };
    let show!: (target: MediaPreviewTarget) => void;
    const persist = createImageCaptionSaver({ getTabs: () => [], getPreview: () => current, setPreview: next => { current = next; show(next); }, dispatch: vi.fn(),
      save: async request => { await save(request.caption); stored = initial.replace(cases.M04.captionBefore, request.caption); },
      load: async () => ({ path: "C:/b03/M04/note.md", kind: "markdown", content: stored, base_dir: "C:/b03/M04", image_paths: [], encoding: "UTF-8", size_bytes: stored.length, modified_at: "now", revision: stored }) });
    function Host() {
      const [target, setTarget] = useState(current); show = setTarget;
      return <MediaPreviewModal {...target} onClose={vi.fn()} onSaveCaption={persist} onConvertAsset={convert} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "画像情報" }));
    fireEvent.change(screen.getByLabelText("キャプション"), { target: { value: cases.M04.captionAfter } });
    fireEvent.click(screen.getByRole("button", { name: "キャプションを保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain("試験用caption保存失敗");
    expect((screen.getByLabelText("キャプション") as HTMLInputElement).value).toBe(cases.M04.captionAfter);
    expect(stored).toBe(initial);
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "画像の説明文をコピー" }));
    await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith(cases.M04.captionBefore));
    fireEvent.click(screen.getByRole("button", { name: "キャプションを保存" }));
    expect((screen.getByRole("button", { name: "保存中…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存中…" }));
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => { resolveSave(); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(stored).toBe(initial.replace(cases.M04.captionBefore, cases.M04.captionAfter));
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "画像の説明文をコピー" }));
    await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith(cases.M04.captionAfter));
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "コードをMarkdownでコピー" }));
    await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith(`![${cases.M04.captionAfter}](original.png)`));
    fireEvent.click(screen.getByRole("button", { name: "埋め込みに変換" }));
    await waitFor(() => expect(convert).toHaveBeenCalledOnce());
    expect(convert.mock.calls[0][0].occurrence.expected).toBe(`![${cases.M04.captionAfter}](original.png)`);
  });

  it("B03-M07 captionのF2からEscapeで取り消し、本文へ迷子にならず再度編集・確定する", () => {
    let markdown = cases.M07.markdown;
    const edit = vi.fn(); const open = vi.fn(); const bubbledKeys: Array<{ key: string; prevented: boolean }> = [];
    const keyObserver = (event: KeyboardEvent) => { if (["F2", "Escape"].includes(event.key)) bubbledKeys.push({ key: event.key, prevented: event.defaultPrevented }); };
    window.addEventListener("keydown", keyObserver);
    function Host() {
      const [content, setContent] = useState(markdown);
      return <MarkdownPreview content={content} documentPath="C:/b03/M07/note.md" baseDir="C:/b03/M07" imageVersions={{}} readOnly allowBlockActions onMediaOpen={open}
        onTextEdit={(base, from, to, replacement) => { edit(base, from, to, replacement); markdown = content.slice(0, from) + replacement + content.slice(to); setContent(markdown); return true; }} />;
    }
    try {
      const { container } = render(<Host />);
      const caption = screen.getByRole("button", { name: "キャプション: 元の説明" });
      caption.focus(); fireEvent.keyDown(caption, { key: "F2" });
      const input = screen.getByRole("textbox", { name: "プレビューのテキストを編集" });
      expect(document.activeElement).toBe(input); fireEvent.change(input, { target: { value: cases.M07.cancelledCaption } }); fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("textbox")).toBeNull(); expect(markdown).toBe(cases.M07.markdown); expect(edit).not.toHaveBeenCalled();
      const returnedCaption = screen.getByRole("button", { name: "キャプション: 元の説明" });
      const preview = container.querySelector(".markdown-body");
      expect.soft([returnedCaption, preview]).toContain(document.activeElement);
      expect.soft(bubbledKeys.every(event => event.prevented)).toBe(true);
      // 後続の成功経路も確認する。復帰focusの上記失敗はsoft assertで保持する。
      returnedCaption.focus(); fireEvent.keyDown(returnedCaption, { key: "F2" });
      const retry = screen.getByRole("textbox", { name: "プレビューのテキストを編集" }); expect((retry as HTMLTextAreaElement).value).toBe("元の説明");
      fireEvent.change(retry, { target: { value: cases.M07.committedCaption } }); fireEvent.keyDown(retry, { key: "Enter" });
      expect(edit).toHaveBeenCalledOnce(); expect(markdown).toBe(cases.M07.markdown.replace("元の説明", cases.M07.committedCaption)); expect(open).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", keyObserver); }
  });
});
