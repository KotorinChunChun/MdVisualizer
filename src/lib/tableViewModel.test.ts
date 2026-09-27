import { describe, expect, it } from "vitest";
import { sortTableRows, tableColumnValueCounts, toggleTableSort } from "./tableViewModel";

describe("table view model", () => {
  it("toggles each column through ascending, descending, and cleared while keeping other priorities", () => {
    let sort = toggleTableSort([], 1);
    expect(sort).toEqual([{ column: 1, direction: "ascending" }]);
    sort = toggleTableSort(sort, 0);
    expect(sort).toEqual([{ column: 0, direction: "ascending" }, { column: 1, direction: "ascending" }]);
    sort = toggleTableSort(sort, 1);
    expect(sort).toEqual([{ column: 1, direction: "descending" }, { column: 0, direction: "ascending" }]);
    expect(toggleTableSort(sort, 1)).toEqual([{ column: 0, direction: "ascending" }]);
  });

  it("sorts multiple columns stably", () => {
    const rows = [{ group: "A", value: "2" }, { group: "A", value: "1" }, { group: "B", value: "1" }, { group: "A", value: "1" }];
    const sorted = sortTableRows(rows, [{ column: 0, direction: "ascending" }, { column: 1, direction: "ascending" }], (row, column) => column === 0 ? row.group : row.value, (left, right) => left.localeCompare(right, "ja", { numeric: true }));
    expect(sorted).toEqual([rows[1], rows[3], rows[0], rows[2]]);
  });

  it("filters slicer candidates without changing selection counts", () => {
    const rows = [["Tokyo", "1"], ["Osaka", "2"], ["Tokyo", "3"]];
    expect(tableColumnValueCounts(rows, 0)).toEqual([["Osaka", 1], ["Tokyo", 2]]);
    expect(tableColumnValueCounts(rows, 0, "to")).toEqual([["Tokyo", 2]]);
  });
});
