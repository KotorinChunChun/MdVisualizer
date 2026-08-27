import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableEditorDialog } from "./TableEditorDialog";

describe("TableEditorDialog grid editing", () => {
  afterEach(cleanup);

  it("moves between cells with Enter and arrow keys", async () => {
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} onCancel={() => undefined} onSave={() => true} />);
    const firstHeader = screen.getByRole("textbox", { name: "列 1の見出し" });
    firstHeader.focus();
    fireEvent.keyDown(firstHeader, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "行 1 列 1" })));
    const firstCell = screen.getByRole("textbox", { name: "行 1 列 1" }) as HTMLInputElement;
    firstCell.setSelectionRange(1, 1);
    fireEvent.keyDown(firstCell, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "行 1 列 2" })));
  });

  it("pastes a TSV rectangle and expands rows and columns", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["old"]]} onCancel={() => undefined} onSave={onSave} />);
    const firstCell = screen.getByRole("textbox", { name: "行 1 列 1" });
    fireEvent.paste(firstCell, { clipboardData: { getData: () => "x\ty\n1\t2" } });
    expect((screen.getByRole("textbox", { name: "行 2 列 2" }) as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "反映" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ headers: ["A", "列 2"], rows: [["x", "y"], ["1", "2"]] }));
  });

  it("copies a selected rectangular range as TSV", () => {
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} onCancel={() => undefined} onSave={() => true} />);
    const dialog = screen.getByRole("dialog", { name: "表を編集" });
    const first = within(dialog).getByRole("textbox", { name: "列 1の見出し" });
    const last = within(dialog).getByRole("textbox", { name: "行 1 列 2" });
    fireEvent.mouseDown(first);
    fireEvent.mouseEnter(last);
    fireEvent.mouseUp(window);
    const setData = vi.fn();
    fireEvent.copy(last, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "A\tB\n1\t2");
  });

  it("recalculates aggregate cells and saves calculated values", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog
      initialHeaders={["項目", "値", "平均"]}
      initialRows={[["A", "10", "old"], ["B", "20", "old"], ["合計", "old", "old"]]}
      onCancel={() => undefined}
      onSave={onSave}
    />);

    const rowAverage = screen.getByRole("textbox", { name: "行 1 列 3" }) as HTMLInputElement;
    const columnTotal = screen.getByRole("textbox", { name: "行 3 列 2" }) as HTMLInputElement;
    const intersection = screen.getByRole("textbox", { name: "行 3 列 3" }) as HTMLInputElement;
    expect(rowAverage.value).toBe("10");
    expect(columnTotal.value).toBe("30");
    expect(intersection.value).toBe("");
    expect(rowAverage.readOnly).toBe(true);
    expect(columnTotal.readOnly).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: "行 1 列 2" }), { target: { value: "15" } });
    expect(rowAverage.value).toBe("15");
    expect(columnTotal.value).toBe("35");
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      rows: [["A", "15", "15"], ["B", "20", "20"], ["合計", "35", ""]],
    }));
  });
});
