import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalFileHeader } from "./ExternalFileHeader";

vi.mock("../lib/commands", () => ({ openContainingFolder: vi.fn() }));

describe("ExternalFileHeader", () => {
  afterEach(cleanup);

  it("長い名前を省略表示し、クリックから名称変更する", async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    render(<ExternalFileHeader source="images/1234567890abcdefghij.png" path="C:\\docs\\images\\1234567890abcdefghij.png" onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "1234567890.....j.png" }));
    const input = screen.getByLabelText("外部ファイル名（拡張子を除く）") as HTMLInputElement;
    expect(input.value).toBe("1234567890abcdefghij");
    expect(screen.getByText(".png")).not.toBeNull();
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("renamed.png"));
  });

  it("禁止文字を含む名前はコールバックへ渡さない", async () => {
    const onRename = vi.fn();
    const onError = vi.fn();
    render(<ExternalFileHeader source="old.png" path="C:\\docs\\old.png" onRename={onRename} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "old.png" }));
    fireEvent.change(screen.getByLabelText("外部ファイル名（拡張子を除く）"), { target: { value: "bad:name" } });
    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("使用できない文字"));
  });

  it("ファイル操作は常設せず、ファイル名の右クリックメニューへ表示する", () => {
    render(<ExternalFileHeader source="old.png" path="C:\\docs\\old.png" onRename={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "フォルダーを開く" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "old.png" }), { clientX: 20, clientY: 30 });
    expect(screen.getByRole("menu", { name: "old.pngのファイル操作" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "フォルダーを開く" })).not.toBeNull();
    expect(screen.queryByText("外部参照")).toBeNull();
  });
});
