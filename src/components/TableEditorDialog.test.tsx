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

  it("applies the current edit with Ctrl+A", () => {
    const onSave = vi.fn(() => true);
    const onCancel = vi.fn();
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["old"]]} onCancel={onCancel} onSave={onSave} />);
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" });
    fireEvent.change(cell, { target: { value: "new" } });

    fireEvent.keyDown(cell, { key: "a", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ headers: ["A"], rows: [["new"]] }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("inserts rows and columns at table boundaries", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} onCancel={() => undefined} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "列 2の左に挿入" }));
    fireEvent.click(screen.getByRole("button", { name: "行 1の下に挿入" }));
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      headers: ["A", "列 3", "B"],
      rows: [["1", "", "2"], ["", "", ""]],
    }));
  });

  it("reorders rows and columns with their drag handles", () => {
    const onSave = vi.fn(() => true);
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"], ["3", "4"]]} onCancel={() => undefined} onSave={onSave} />);

    fireEvent.dragStart(screen.getByRole("button", { name: "列 1をドラッグして並び替え" }), { dataTransfer });
    const secondColumn = screen.getByRole("textbox", { name: "列 2の見出し" }).closest("th")!;
    fireEvent.dragOver(secondColumn, { dataTransfer });
    expect(secondColumn.classList.contains("is-drop-target")).toBe(true);
    fireEvent.drop(secondColumn, { dataTransfer });
    expect(screen.getByRole("textbox", { name: "列 2の見出し" }).closest("th")?.classList.contains("is-reordered")).toBe(true);
    fireEvent.dragStart(screen.getByRole("button", { name: "行 1をドラッグして並び替え" }), { dataTransfer });
    const secondRow = screen.getByRole("button", { name: "行 2をドラッグして並び替え" }).closest("tr")!;
    fireEvent.dragOver(secondRow, { dataTransfer });
    expect(secondRow.classList.contains("is-drop-target")).toBe(true);
    fireEvent.drop(secondRow, { dataTransfer });
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(dataTransfer.setData).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      headers: ["B", "A"],
      rows: [["4", "3"], ["2", "1"]],
    }));
  });

  it("selects a whole column or row by clicking its drag handle", () => {
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"], ["3", "4"]]} onCancel={() => undefined} onSave={() => true} />);
    const columnHandle = screen.getByRole("button", { name: "列 2をドラッグして並び替え" });
    const rowHandle = screen.getByRole("button", { name: "行 1をドラッグして並び替え" });
    const setData = vi.fn();

    fireEvent.click(columnHandle);
    fireEvent.copy(columnHandle, { clipboardData: { setData } });
    expect(setData).toHaveBeenLastCalledWith("text/plain", "B\n2\n4");

    fireEvent.click(rowHandle);
    fireEvent.copy(rowHandle, { clipboardData: { setData } });
    expect(setData).toHaveBeenLastCalledWith("text/plain", "1\t2");
  });

  it("places three alignment buttons to the right of each column heading", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} initialAlignments={[null, null]} showAlignments onCancel={() => undefined} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "列 1を右揃え" }));
    expect(screen.getByRole("button", { name: "列 1を右揃え" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ alignments: ["right", null] }));
  });

  it("adds total, average, and count rows or columns from the aggregate menu", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["項目", "値"]} initialRows={[["A", "10"], ["B", "20"]]} onCancel={() => undefined} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "集計を追加" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "合計行" }));
    fireEvent.click(screen.getByRole("button", { name: "集計を追加" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "平均列" }));
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      headers: ["項目", "値", "平均"],
      rows: [["A", "10", "10"], ["B", "20", "20"], ["合計", "30", ""]],
    }));
  });

  it("can insert the first row into an empty table", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[]} onCancel={() => undefined} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "最初の行を挿入" }));
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ rows: [[""]] }));
  });
});
