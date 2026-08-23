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

  it("copies rendered text and original Markdown independently", async () => {
    const onResult = vi.fn();
    const props = { x: 10, y: 20, plainText: "表示内容", markdownText: "**表示内容**", canEdit: true, onEdit: vi.fn(), onSelectLine: vi.fn(), onSelectAll: vi.fn(), onResult, onError: vi.fn(), onDismiss: vi.fn() };
    const { rerender } = render(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "コピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("表示内容"));

    rerender(<PreviewContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Markdownでコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("**表示内容**"));
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
});
