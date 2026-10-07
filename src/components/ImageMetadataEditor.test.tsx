import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageMetadataEditor } from "./ImageMetadataEditor";

const context = {
  markdownPath: "C:\\docs\\readme.md",
  imagePath: "C:\\docs\\images\\photo.png",
  source: "images/photo.png",
  sourceOffset: 12,
  caption: "以前",
};

afterEach(cleanup);

describe("ImageMetadataEditor", () => {
  it.each(["caption", "rename"] as const)("%s保存中に別画像へ切り替えた後の拒否を新しい画像へ表示しない", async operation => {
    let reject!: (reason: unknown) => void;
    const pending = vi.fn(() => new Promise<void>((_resolve, no) => { reject = no; }));
    const save = operation === "caption" ? pending : vi.fn().mockResolvedValue(undefined);
    const rename = operation === "rename" ? pending : vi.fn().mockResolvedValue(undefined);
    const view = render(<ImageMetadataEditor context={context} onSaveCaption={save} onRename={rename} />);
    fireEvent.change(screen.getByLabelText(operation === "caption" ? "キャプション" : "ファイル名"), { target: { value: operation === "caption" ? "変更" : "renamed.png" } });
    fireEvent.click(screen.getByRole("button", { name: operation === "caption" ? "キャプションを保存" : "名前を変更" }));
    const other = { ...context, sourceOffset: 100, caption: "別の画像", imagePath: "C:/docs/other.png" };
    view.rerender(<ImageMetadataEditor context={other} onSaveCaption={save} onRename={rename} />);
    fireEvent.change(screen.getByLabelText("キャプション"), { target: { value: "別の入力" } });
    await act(async () => { reject(new Error("古い画像の失敗")); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("キャプション") as HTMLInputElement).value).toBe("別の入力");
    expect((screen.getByRole("button", { name: "キャプションを保存" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("saves a caption for the selected occurrence", async () => {
    const onSaveCaption = vi.fn().mockResolvedValue(undefined);
    render(<ImageMetadataEditor context={context} onSaveCaption={onSaveCaption} onRename={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("キャプション"), { target: { value: "新しい説明" } });
    fireEvent.click(screen.getByRole("button", { name: "キャプションを保存" }));
    await waitFor(() => expect(onSaveCaption).toHaveBeenCalledWith(context, "新しい説明"));
  });

  it("rejects paths in the filename field", () => {
    render(<ImageMetadataEditor context={context} onSaveCaption={vi.fn()} onRename={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ファイル名"), { target: { value: "..\\other.png" } });
    fireEvent.click(screen.getByRole("button", { name: "名前を変更" }));
    expect(screen.getByRole("alert").textContent).toContain("使用できない記号");
  });
});
