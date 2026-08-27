import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DelimitedTableBlock } from "./DelimitedTableBlock";

describe("DelimitedTableBlock", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps SearchPanes off initially and resets it to off for new source", () => {
    const view = render(<DelimitedTableBlock language="csv" source={"name,city\nAlice,Tokyo\nBob,Osaka"} />);
    const toggle = screen.getByRole("button", { name: "SearchPanes" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("SearchPanes")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByLabelText("SearchPanes")).toBeTruthy();
    view.rerender(<DelimitedTableBlock language="csv" source={"name,city\nCarol,Nagoya"} />);
    expect(screen.getByRole("button", { name: "SearchPanes" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("SearchPanes")).toBeNull();
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

  it("filters through SearchPanes and toggles visible columns only after explicit actions", () => {
    render(<DelimitedTableBlock language="tsv-h" source={"name\tcity\nAlice\tTokyo\nBob\tOsaka\nCarol\tTokyo"} />);
    fireEvent.click(screen.getByRole("button", { name: "SearchPanes" }));
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
    expect(screen.queryByRole("button", { name: "SearchPanes" })).toBeNull();
  });
});
