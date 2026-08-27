import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DelimitedTableBlock } from "./DelimitedTableBlock";

describe("DelimitedTableBlock", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the slicer off initially and resets it to off for new source", () => {
    const view = render(<DelimitedTableBlock language="csv" source={"name,city\nAlice,Tokyo\nBob,Osaka"} />);
    const toggle = screen.getByRole("button", { name: "スライサー" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("スライサー")).toBeNull();
    expect(screen.queryByRole("button", { name: "フィルタ解除" })).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByLabelText("スライサー")).toBeTruthy();
    expect(screen.getByRole("button", { name: "フィルタ解除" })).toBeTruthy();
    view.rerender(<DelimitedTableBlock language="csv" source={"name,city\nCarol,Nagoya"} />);
    expect(screen.getByRole("button", { name: "スライサー" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("スライサー")).toBeNull();
  });

  it("filters and sorts rows without changing the source table", () => {
    render(<DelimitedTableBlock language="csv-h" source={"name,score\nAlice,10\nBob,2\nCarol,30"} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "検索" }), { target: { value: "Bob" } });
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("1 / 3 行")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "検索" }), { target: { value: "" } });
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

  it("displays vertical and horizontal aggregate results from the source", () => {
    render(<DelimitedTableBlock language="csv" source={"項目,値1,値2,合計\nA,10,20,old\nB,5,x,old\n合計,old,old,old"} />);
    const bodyRows = screen.getByRole("table").querySelectorAll("tbody tr");

    expect(bodyRows[0].textContent).toBe("A102030");
    expect(bodyRows[1].textContent).toBe("B5x5");
    expect(bodyRows[2].textContent).toBe("合計1520");
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

  it("serializes calculated cells when applying an edited delimited table", () => {
    const onSave = vi.fn().mockReturnValue(true);
    render(<DelimitedTableBlock language="csv" source={"項目,値\nA,10\nB,20\n合計,"} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "表を編集" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "表を編集" })).getByRole("button", { name: "反映" }));

    expect(onSave).toHaveBeenCalledWith("項目,値\nA,10\nB,20\n合計,30");
  });

  it("requests the current Blob-based CSV download", () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:table");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let clickedAnchor: { href: string; download: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchor = { href: this.href, download: this.download };
    });
    render(<DelimitedTableBlock language="csv" source={"name,score\nAlice,10"} />);

    fireEvent.click(screen.getByRole("button", { name: "CSV" }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ type: "text/csv;charset=utf-8" }));
    expect(clickedAnchor).toEqual({ href: "blob:table", download: "table.csv" });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:table");
  });

  it("delegates the current print action to the whole window", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<DelimitedTableBlock language="csv" source={"name,score\nAlice,10"} />);

    fireEvent.click(screen.getByRole("button", { name: "印刷" }));

    expect(print).toHaveBeenCalledOnce();
  });

  it("shows a clear parsing error and does not render controls", () => {
    render(<DelimitedTableBlock language="csv" source={'name,note\nAlice,"broken'} />);
    expect(screen.getByRole("alert").textContent).toContain("閉じられていません");
    expect(screen.queryByRole("button", { name: "スライサー" })).toBeNull();
  });
});
