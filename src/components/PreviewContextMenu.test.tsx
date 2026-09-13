import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewContextMenu } from "./PreviewContextMenu";

afterEach(cleanup);

describe("PreviewContextMenu", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it("copies Markdown by default and rendered text explicitly", async () => {
    const onResult = vi.fn();
    const props = { x: 10, y: 20, plainText: "表示内容", markdownText: "**表示内容**", canEdit: true, onEdit: vi.fn(), onSelectLine: vi.fn(), onSelectAll: vi.fn(), onResult, onError: vi.fn(), onDismiss: vi.fn() };
    const { rerender } = render(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "マークダウンでコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("**表示内容**"));

    rerender(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "プレーンテキストでコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("表示内容"));
  });

  it("runs edit and selection actions and disables edit when unavailable", () => {
    const onEdit = vi.fn();
    const onSelectLine = vi.fn();
    const onSelectAll = vi.fn();
    const props = { x: 0, y: 0, plainText: "text", markdownText: "text", canEdit: true, onEdit, onSelectLine, onSelectAll, onResult: vi.fn(), onError: vi.fn(), onDismiss: vi.fn() };
    const { rerender } = render(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "編集" }));
    expect(onEdit).toHaveBeenCalledOnce();

    rerender(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "行選択" }));
    expect(onSelectLine).toHaveBeenCalledOnce();

    rerender(<PreviewContextMenu {...props} canEdit={false} />);
    expect((screen.getByRole("menuitem", { name: "編集" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("selects and copies a table row without removing block selection", async () => {
    const onSelectLine = vi.fn();
    const onSelectRow = vi.fn();
    const props = { x: 0, y: 0, plainText: "A 1", markdownText: "| A | 1 |", rowTsv: "A\t1", canEdit: true, onEdit: vi.fn(), onSelectLine, onSelectRow, onSelectAll: vi.fn(), onResult: vi.fn(), onError: vi.fn(), onDismiss: vi.fn() };
    const { rerender } = render(<PreviewContextMenu {...props} />);

    fireEvent.click(screen.getByRole("menuitem", { name: "行選択" }));
    expect(onSelectRow).toHaveBeenCalledOnce();

    rerender(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "選択した行をTSVでコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("A\t1"));

    rerender(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "ブロック全体を選択" }));
    expect(onSelectLine).toHaveBeenCalledOnce();
  });
});
