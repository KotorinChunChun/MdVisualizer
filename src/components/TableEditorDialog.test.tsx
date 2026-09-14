import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableEditorDialog, type EditableTableData } from "./TableEditorDialog";
import { DocumentSaveContext } from "../contexts/DocumentSaveContext";

describe("TableEditorDialog grid editing", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
    const onSave = vi.fn((_table: EditableTableData) => true);
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["old", "keep"]]} onCancel={() => undefined} onSave={onSave} />);
    const firstCell = screen.getByRole("textbox", { name: "行 1 列 1" });
    fireEvent.mouseDown(firstCell);
    fireEvent.mouseEnter(screen.getByRole("textbox", { name: "行 1 列 2" }));
    fireEvent.mouseUp(window);
    fireEvent.paste(firstCell, { clipboardData: { getData: () => "x\ty\n1\t2" } });
    expect((screen.getByRole("textbox", { name: "行 2 列 2" }) as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "反映" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ headers: ["A", "B"], rows: [["x", "y"], ["1", "2"]] }));
  });

  it("expands TSV copied from Excel even when only one cell is selected", () => {
    const onSave = vi.fn((_table: EditableTableData) => true);
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["old"]]} onCancel={() => undefined} onSave={onSave} />);
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" });

    fireEvent.paste(cell, { clipboardData: { getData: () => "x\ty\r\n1\t2\r\n" } });

    expect((screen.getByRole("textbox", { name: "行 2 列 2" }) as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "反映" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      headers: ["A", "列 2"],
      rows: [["x", "y"], ["1", "2"]],
    }));
  });

  it("starts a rectangular paste at the top-left cell for a reverse selection", () => {
    const onSave = vi.fn((_table: EditableTableData) => true);
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"], ["3", "4"]]} onCancel={() => undefined} onSave={onSave} />);
    const topLeft = screen.getByRole("textbox", { name: "行 1 列 1" });
    const bottomRight = screen.getByRole("textbox", { name: "行 2 列 2" });
    fireEvent.mouseDown(bottomRight);
    fireEvent.mouseEnter(topLeft);
    fireEvent.mouseUp(window);

    fireEvent.paste(bottomRight, { clipboardData: { getData: () => "x\ty\n5\t6" } });
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      headers: ["A", "B"],
      rows: [["x", "y"], ["5", "6"]],
    }));
  });

  it("undoes an expanded multi-cell paste as one operation with Ctrl+Z", () => {
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["old", "keep"]]} onCancel={() => undefined} onSave={() => true} />);
    const first = screen.getByRole("textbox", { name: "行 1 列 1" });
    fireEvent.paste(first, { clipboardData: { getData: () => "x\ty\tz\n1\t2\t3" } });
    expect(screen.getByRole("textbox", { name: "行 2 列 3" })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "行 1 列 1" }), { key: "z", ctrlKey: true });

    expect((screen.getByRole("textbox", { name: "行 1 列 1" }) as HTMLInputElement).value).toBe("old");
    expect((screen.getByRole("textbox", { name: "行 1 列 2" }) as HTMLInputElement).value).toBe("keep");
    expect(screen.queryByRole("textbox", { name: "行 2 列 1" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "列 3の見出し" })).toBeNull();
  });

  it("inserts pasted text at the caret when only one cell is selected", () => {
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["abcd"]]} onCancel={() => undefined} onSave={() => true} />);
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" }) as HTMLInputElement;
    fireEvent.mouseDown(cell);
    cell.setSelectionRange(2, 2);

    fireEvent.paste(cell, { clipboardData: { getData: () => "XY" } });

    expect(cell.value).toBe("abXYcd");
  });

  it("undoes a single-cell paste with Ctrl+Z", () => {
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["abcd"]]} onCancel={() => undefined} onSave={() => true} />);
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" }) as HTMLInputElement;
    fireEvent.mouseDown(cell);
    cell.setSelectionRange(2, 2);
    fireEvent.paste(cell, { clipboardData: { getData: () => "XY" } });

    fireEvent.keyDown(cell, { key: "z", ctrlKey: true });

    expect(cell.value).toBe("abcd");
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
    expect(intersection.value).toBe("-");
    expect(rowAverage.readOnly).toBe(true);
    expect(columnTotal.readOnly).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: "行 1 列 2" }), { target: { value: "15" } });
    expect(rowAverage.value).toBe("15");
    expect(columnTotal.value).toBe("35");
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      rows: [["A", "15", "15"], ["B", "20", "20"], ["合計", "35", "-"]],
    }));
  });

  it("applies the current edit with Ctrl+Enter", () => {
    const onSave = vi.fn(() => true);
    const onCancel = vi.fn();
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["old"]]} onCancel={onCancel} onSave={onSave} />);
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" });
    fireEvent.change(cell, { target: { value: "new" } });

    fireEvent.keyDown(cell, { key: "Enter", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ headers: ["A"], rows: [["new"]] }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("selects text in a single editing cell with Ctrl+A", () => {
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"], ["3", "4"]]} onCancel={() => undefined} onSave={() => true} />);
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" });
    fireEvent.keyDown(cell, { key: "a", ctrlKey: true });
    expect((cell as HTMLInputElement).selectionStart).toBe(0);
    expect((cell as HTMLInputElement).selectionEnd).toBe(1);
    expect(screen.getByRole("textbox", { name: "行 2 列 2" }).classList.contains("is-selected")).toBe(false);
  });

  it("keeps native Ctrl+C for selected text in one editing cell", () => {
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["first", "second"]]} onCancel={() => undefined} onSave={() => true} />);
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" }) as HTMLInputElement;
    fireEvent.keyDown(cell, { key: "a", ctrlKey: true });
    const setData = vi.fn();

    const wasNotCancelled = fireEvent.copy(cell, { clipboardData: { setData } });

    expect(wasNotCancelled).toBe(true);
    expect(setData).not.toHaveBeenCalled();
  });

  it("reflects table edits before saving the document with Ctrl+S", async () => {
    const sequence: string[] = [];
    const onSave = vi.fn(() => { sequence.push("reflect"); return true; });
    const onDocumentSave = vi.fn(async () => { sequence.push("document-save"); return true; });
    const onCancel = vi.fn();
    render(
      <DocumentSaveContext.Provider value={onDocumentSave}>
        <TableEditorDialog initialHeaders={["A"]} initialRows={[["value"]]} onCancel={onCancel} onSave={onSave} />
      </DocumentSaveContext.Provider>,
    );

    const cell = screen.getByRole("textbox", { name: "行 1 列 1" });
    fireEvent.keyDown(cell, { key: "s", ctrlKey: true });

    await waitFor(() => expect(onDocumentSave).toHaveBeenCalledOnce());
    expect(sequence).toEqual(["reflect", "document-save"]);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("edits and applies a 1,000-row table", () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => [`row-${index + 1}`, String(index + 1)]);
    const onSave = vi.fn((_table: EditableTableData) => true);
    const { container } = render(<TableEditorDialog initialHeaders={["name", "value"]} initialRows={rows} onCancel={() => undefined} onSave={onSave} />);
    const lastCell = container.querySelector<HTMLInputElement>('input[aria-label="行 1000 列 2"]')!;

    fireEvent.change(lastCell, { target: { value: "updated" } });
    fireEvent.keyDown(lastCell, { key: "Enter", ctrlKey: true });

    const saved = onSave.mock.calls[0]?.[0];
    expect(saved?.rows).toHaveLength(1_000);
    expect(saved?.rows[999]).toEqual(["row-1000", "updated"]);
  }, 15_000);

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
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"], ["3", "4"]]} onCancel={() => undefined} onSave={onSave} />);
    const dialog = screen.getByRole("dialog", { name: "表を編集" });

    const firstColumn = screen.getByRole("textbox", { name: "列 1の見出し" }).closest("th")!;
    const secondColumn = screen.getByRole("textbox", { name: "列 2の見出し" }).closest("th")!;
    vi.spyOn(firstColumn, "getBoundingClientRect").mockReturnValue({ left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}) });
    vi.spyOn(secondColumn, "getBoundingClientRect").mockReturnValue({ left: 100, right: 200, top: 0, bottom: 40, width: 100, height: 40, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(screen.getByRole("button", { name: "列 1をドラッグして並び替え" }), { pointerId: 1, button: 0, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(dialog, { pointerId: 1, clientX: 150, clientY: 10 });
    expect(secondColumn.classList.contains("is-drop-target")).toBe(true);
    expect(screen.getByRole("textbox", { name: "行 1 列 2" }).closest("td")?.classList.contains("is-drop-target")).toBe(true);
    expect(screen.getByRole("textbox", { name: "行 2 列 2" }).closest("td")?.classList.contains("is-drop-target")).toBe(true);
    fireEvent.pointerUp(dialog, { pointerId: 1, clientX: 150, clientY: 10 });
    expect(screen.getByRole("textbox", { name: "列 2の見出し" }).closest("th")?.classList.contains("is-reordered")).toBe(true);
    const firstRow = screen.getByRole("button", { name: "行 1をドラッグして並び替え" }).closest("tr")!;
    const secondRow = screen.getByRole("button", { name: "行 2をドラッグして並び替え" }).closest("tr")!;
    vi.spyOn(firstRow, "getBoundingClientRect").mockReturnValue({ left: 0, right: 200, top: 40, bottom: 80, width: 200, height: 40, x: 0, y: 40, toJSON: () => ({}) });
    vi.spyOn(secondRow, "getBoundingClientRect").mockReturnValue({ left: 0, right: 200, top: 80, bottom: 120, width: 200, height: 40, x: 0, y: 80, toJSON: () => ({}) });
    fireEvent.pointerDown(screen.getByRole("button", { name: "行 1をドラッグして並び替え" }), { pointerId: 2, button: 0, clientX: 10, clientY: 60 });
    fireEvent.pointerMove(dialog, { pointerId: 2, clientX: 10, clientY: 100 });
    expect(secondRow.classList.contains("is-drop-target")).toBe(true);
    fireEvent.pointerUp(dialog, { pointerId: 2, clientX: 10, clientY: 100 });
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

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

  it("行のドラッグつまみは縦の三点で、列の横つまみと区別する", () => {
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["1"]]} onCancel={() => undefined} onSave={() => true} />);
    const rowHandle = screen.getByRole("button", { name: "行 1をドラッグして並び替え" });
    const columnHandle = screen.getByRole("button", { name: "列 1をドラッグして並び替え" });
    expect(rowHandle.textContent).toBe("⋮");
    expect(rowHandle.classList.contains("table-editor-row-drag-handle")).toBe(true);
    expect(columnHandle.classList.contains("table-editor-column-drag-handle")).toBe(true);
  });

  it("places icon alignment toggles on both sides of the heading and treats release as center", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} initialAlignments={[null, null]} showAlignments onCancel={() => undefined} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "列 1を右揃え" }));
    expect(screen.getByRole("button", { name: "列 1を右揃え" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("textbox", { name: "列 1の見出し" }) as HTMLInputElement).style.textAlign).toBe("right");
    expect((screen.getByRole("textbox", { name: "行 1 列 1" }) as HTMLInputElement).style.textAlign).toBe("right");
    fireEvent.click(screen.getByRole("button", { name: "列 1を右揃え" }));
    expect(screen.getByRole("button", { name: "列 1を右揃え" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("textbox", { name: "列 1の見出し" }) as HTMLInputElement).style.textAlign).toBe("center");
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ alignments: ["center", null] }));
  });

  it("uses minus popup buttons and confirms before deleting rows or columns with data", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} onCancel={() => undefined} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "行 1を削除" }));
    let confirmation = screen.getByRole("alertdialog", { name: "削除の確認" });
    expect(within(confirmation).getByText("行 1にはデータがあります。削除しますか？")).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole("button", { name: "キャンセル" }));
    expect(screen.getByRole("textbox", { name: "行 1 列 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "列 2を削除" }));
    confirmation = screen.getByRole("alertdialog", { name: "削除の確認" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "削除" }));
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ headers: ["A"], rows: [["1"]] }));
  });

  it("shows both upper and lower insert buttons on every row", () => {
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["1"], ["2"]]} onCancel={() => undefined} onSave={() => true} />);

    expect(screen.getByRole("button", { name: "行 1の上に挿入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "行 1の下に挿入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "行 2の上に挿入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "行 2の下に挿入" })).toBeTruthy();
  });

  it("shows both left and right insert buttons on every column", () => {
    render(<TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} onCancel={() => undefined} onSave={() => true} />);

    expect(screen.getByRole("button", { name: "列 1の左に挿入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "列 1の右に挿入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "列 2の左に挿入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "列 2の右に挿入" })).toBeTruthy();
  });

  it("opens a foreground table-editor menu and blocks the background context menu", () => {
    const backgroundMenu = vi.fn();
    const { container } = render(<div onContextMenu={backgroundMenu}><TableEditorDialog initialHeaders={["A", "B"]} initialRows={[["1", "2"]]} onCancel={() => undefined} onSave={() => true} /></div>);
    const overlay = container.querySelector(".table-editor-overlay")!;
    const cell = screen.getByRole("textbox", { name: "行 1 列 1" });

    expect(fireEvent.contextMenu(overlay, { clientX: 50, clientY: 60 })).toBe(false);
    expect(backgroundMenu).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("menu", { name: "表編集操作" })).getByRole("menuitem", { name: "列全体を選択" }));

    expect(fireEvent.contextMenu(cell, { clientX: 80, clientY: 90 })).toBe(false);
    const menu = screen.getByRole("menu", { name: "表編集操作" });
    expect(menu.classList.contains("table-editor-context-menu")).toBe(true);
    expect((menu as HTMLElement).style.zIndex).toBe("12030");
    expect(backgroundMenu).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "行全体を選択" }));

    const setData = vi.fn();
    fireEvent.copy(cell, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "1\t2");
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
      rows: [["A", "10", "10"], ["B", "20", "20"], ["合計", "30", "-"]],
    }));
  });

  it("does not show the removed table-editor explanatory note", () => {
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[["1"]]} onCancel={() => undefined} onSave={() => true} />);

    expect(screen.queryByText(/先頭行はヘッダーです/)).toBeNull();
    expect(screen.queryByText(/境界の＋/)).toBeNull();
  });

  it("can insert the first row into an empty table", () => {
    const onSave = vi.fn(() => true);
    render(<TableEditorDialog initialHeaders={["A"]} initialRows={[]} onCancel={() => undefined} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "最初の行を挿入" }));
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ rows: [[""]] }));
  });
});
