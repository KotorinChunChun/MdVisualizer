import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
