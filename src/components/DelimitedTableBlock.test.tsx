import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DelimitedTableBlock } from "./DelimitedTableBlock";

const nativeMocks = vi.hoisted(() => ({
  copyTextFile: vi.fn(),
}));
vi.mock("../lib/commands", () => ({ copyTextFile: nativeMocks.copyTextFile }));

describe("DelimitedTableBlock", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("keeps the slicer off initially and resets it to off for new source", () => {
    const view = render(<DelimitedTableBlock language="csv" source={"name,city\nAlice,Tokyo\nBob,Osaka"} />);
    const toggle = screen.getByRole("button", { name: "スライサー" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("スライサー")).toBeNull();
    expect(screen.queryByRole("button", { name: "フィルタ解除" })).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByLabelText("スライサー")).toBeTruthy();
    const slicer = screen.getByLabelText("スライサー");
    const clearButtons = within(slicer).getAllByRole("button", { name: "フィルタ解除" });
    expect(clearButtons).toHaveLength(2);
    expect(clearButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(within(screen.getByRole("toolbar", { name: "表操作" })).queryByRole("button", { name: "フィルタ解除" })).toBeNull();
    view.rerender(<DelimitedTableBlock language="csv" source={"name,city\nCarol,Nagoya"} />);
    expect(screen.getByRole("button", { name: "スライサー" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("スライサー")).toBeNull();
  });

  it("filters and sorts rows without changing the source table", () => {
    render(<DelimitedTableBlock language="csv-h" source={"name,score\nAlice,10\nBob,2\nCarol,30"} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "検索キーワードを入力" }), { target: { value: "Bob" } });
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("1 / 3 行")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "検索キーワードを入力" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /score/ }));
    const bodyRows = screen.getByRole("table").querySelectorAll("tbody tr");
    expect(bodyRows[0].textContent).toContain("Bob");
  });

  it("filters through the slicer and toggles visible columns only after explicit actions", () => {
    render(<DelimitedTableBlock language="tsv-h" source={"name\tcity\nAlice\tTokyo\nBob\tOsaka\nCarol\tTokyo"} />);
    fireEvent.click(screen.getByRole("button", { name: "スライサー" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Tokyo/ }));
    expect(within(screen.getByRole("table")).queryByText("Bob")).toBeNull();
    expect(screen.getByText("2 / 3 行")).toBeTruthy();
    const slicer = screen.getByLabelText("スライサー");
    const cityClear = within(slicer).getAllByRole("button", { name: "フィルタ解除" })[1];
    expect((cityClear as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cityClear);
    expect(screen.getByText("3 / 3 行")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "列表示" }));
    const columnPanel = screen.getByLabelText("列表示の選択");
    fireEvent.click(within(columnPanel).getByRole("checkbox", { name: "city" }));
    expect(screen.queryByRole("button", { name: /city/ })).toBeNull();
  });

  it("edits headers and cells and returns a serialized body", () => {
    const onSave = vi.fn().mockReturnValue(true);
    render(<DelimitedTableBlock language="tsv" source={"name\tvalue\nold\t1"} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "表を編集" }));
    const dialog = screen.getByRole("dialog", { name: "表を編集" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "列 1の見出し" }), { target: { value: "名前" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "行 1 列 1" }), { target: { value: "new" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith("名前\tvalue\nnew\t1");
    expect(screen.queryByRole("dialog", { name: "表を編集" })).toBeNull();
  });

  it("places the flexible search field at the left edge before right-side operations", () => {
    render(<DelimitedTableBlock language="csv-h" source={"name,score\nAlice,10"} />);
    const toolbar = screen.getByRole("toolbar", { name: "表操作" });
    const items = toolbar.querySelector(".responsive-toolbar__items")!;
    const firstItem = items.firstElementChild!;

    expect(firstItem.querySelector('input[type="search"]')).toBe(screen.getByRole("searchbox", { name: "検索キーワードを入力" }));
    expect(firstItem.nextElementSibling?.querySelector("button")?.textContent).toBe("列表示");
    expect(firstItem.querySelector(".data-grid-search")).toBeTruthy();
    expect(screen.queryByText("検索")).toBeNull();
    expect(screen.getByPlaceholderText("検索キーワードを入力")).toBeTruthy();
    expect(toolbar.querySelector(".responsive-toolbar__label")?.textContent).toBe("CSV-H");
    expect(items.getAttribute("style")).toContain("width: auto");
    expect(items.getAttribute("style")).toContain("flex: 1 1 0px");
  });

  it("displays vertical and horizontal aggregate results from the source", () => {
    render(<DelimitedTableBlock language="csv" source={"項目,値1,値2,合計\nA,10,20,old\nB,5,x,old\n合計,old,old,old"} />);
    const bodyRows = screen.getByRole("table").querySelectorAll("tbody tr");

    expect(bodyRows[0].textContent).toBe("A102030");
    expect(bodyRows[1].textContent).toBe("B5x5");
    expect(bodyRows[2].textContent).toBe("合計152035");
  });

  it("cycles each sort through ascending, descending, and none with the latest column first", () => {
    render(<DelimitedTableBlock language="csv" source={"group,score,name\nB,2,b2\nA,2,a2\nA,1,a1"} />);
    fireEvent.click(screen.getByRole("button", { name: /group:/ }));
    fireEvent.click(screen.getByRole("button", { name: /score:/ }));

    expect(screen.getByRole("button", { name: "score: 昇順、優先順位1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "group: 昇順、優先順位2" })).toBeTruthy();
    expect(screen.getByRole("table").querySelector("tbody tr")?.textContent).toBe("A1a1");

    fireEvent.click(screen.getByRole("button", { name: /score:/ }));
    expect(screen.getByRole("button", { name: "score: 降順、優先順位1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /score:/ }));
    expect(screen.getByRole("button", { name: "score: ソートなし" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "group: 昇順、優先順位1" })).toBeTruthy();
  });

  it("opens the column menu to select, copy, and hide a column", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DelimitedTableBlock language="csv" source={"name,city\nAlice,Tokyo\nBob,Osaka"} />);
    const cityHeader = screen.getByRole("button", { name: /city:/ }).closest("th")!;

    fireEvent.contextMenu(cityHeader, { clientX: 12, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "選択した列のコピー" }));
    expect(writeText).toHaveBeenCalledWith("city\nTokyo\nOsaka");

    fireEvent.contextMenu(cityHeader, { clientX: 12, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "列の非表示" }));
    expect(screen.queryByRole("button", { name: /city:/ })).toBeNull();
  });

  it("selects and copies one displayed row as TSV while retaining block selection", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DelimitedTableBlock language="csv" source={"name,city\nAlice,Tokyo\nBob,Osaka"} />);
    const row = screen.getByText("Alice").closest("tr")!;

    fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });
    expect(screen.getByRole("menuitem", { name: "ブロック全体を選択" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "選択した行をTSVでコピー" }));

    expect(writeText).toHaveBeenCalledWith("Alice\tTokyo");
    expect(row.className).toContain("is-selected-row");
  });

  it("quotes tabs and line breaks when copying a column or row as TSV", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DelimitedTableBlock language="csv" source={'name,notes\nAlice,"line1\nline2"\nBob,"a\tb"'} />);

    const notesHeader = screen.getByRole("button", { name: /notes:/ }).closest("th")!;
    fireEvent.contextMenu(notesHeader);
    fireEvent.click(screen.getByRole("menuitem", { name: "選択した列のコピー" }));
    expect(writeText).toHaveBeenLastCalledWith('notes\n"line1\nline2"\n"a\tb"');

    const aliceRow = screen.getByText("Alice").closest("tr")!;
    fireEvent.contextMenu(aliceRow);
    fireEvent.click(screen.getByRole("menuitem", { name: "選択した行をTSVでコピー" }));
    expect(writeText).toHaveBeenLastCalledWith('Alice\t"line1\nline2"');
  });

  it("serializes calculated cells when applying an edited delimited table", () => {
    const onSave = vi.fn().mockReturnValue(true);
    render(<DelimitedTableBlock language="csv" source={"項目,値\nA,10\nB,20\n合計,"} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "表を編集" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "表を編集" })).getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith("項目,値\nA,10\nB,20\n合計,30");
  });

  it("offers separate CSV and TSV copies without the old CSV menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const notices: Array<{ message: string; actions?: Array<{ label: string; onAction: () => Promise<void> }> }> = [];
    const listener = (event: Event) => { notices.push((event as CustomEvent).detail); };
    window.addEventListener("markdown-toast", listener);
    render(<DelimitedTableBlock language="csv" source={"name,score\nAlice,10"} />);

    expect(screen.queryByRole("button", { name: "CSV" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "CSVコピー" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("name,score\nAlice,10"));
    const csvActions = notices[notices.length - 1]?.actions;
    expect(csvActions?.map((action) => action.label)).toEqual(["ファイルとしてコピー"]);
    nativeMocks.copyTextFile.mockResolvedValue("C:\\temp\\table.csv");
    await csvActions?.[0].onAction();
    expect(nativeMocks.copyTextFile).toHaveBeenLastCalledWith({ filename: "table.csv", content: "name,score\nAlice,10", utf8Bom: true });

    fireEvent.click(screen.getByRole("button", { name: "TSVコピー" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("name\tscore\nAlice\t10"));
    const tsvActions = notices[notices.length - 1]?.actions;
    expect(tsvActions?.map((action) => action.label)).toEqual(["ファイルとしてコピー"]);
    nativeMocks.copyTextFile.mockResolvedValue("C:\\temp\\table.tsv");
    await tsvActions?.[0].onAction();
    expect(nativeMocks.copyTextFile).toHaveBeenLastCalledWith({ filename: "table.tsv", content: "name\tscore\nAlice\t10", utf8Bom: false });
    window.removeEventListener("markdown-toast", listener);
  });

  it("prints only the selected table with all rows outside paging", () => {
    vi.useFakeTimers();
    const source = ["name,score", ...Array.from({ length: 12 }, (_, index) => `row${index + 1},${index + 1}`)].join("\n");
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      const host = document.querySelector(".table-print-host")!;
      expect(document.body.classList.contains("table-print-active")).toBe(true);
      expect(host.querySelectorAll("tbody tr")).toHaveLength(12);
      expect(host.textContent).toContain("row12");
    });
    render(<DelimitedTableBlock language="csv" source={source} />);

    fireEvent.click(screen.getByRole("button", { name: "印刷" }));

    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector(".table-print-host")).toBeTruthy();
    vi.runAllTimers();
    expect(document.querySelector(".table-print-host")).toBeNull();
    expect(document.body.classList.contains("table-print-active")).toBe(false);
  });

  it("shows a clear parsing error and does not render controls", () => {
    render(<DelimitedTableBlock language="csv" source={'name,note\nAlice,"broken'} />);
    expect(screen.getByRole("alert").textContent).toContain("閉じられていません");
    expect(screen.queryByRole("button", { name: "スライサー" })).toBeNull();
  });
});
