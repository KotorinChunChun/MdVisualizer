// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calculateTableAggregates, isTableAggregateResultCell, parseTableNumber, tableAggregateKind } from "./tableAggregation";

describe("table aggregation", () => {
  it("recognizes only exact trimmed Japanese aggregate labels", () => {
    expect(tableAggregateKind(" 合計 ")).toBe("sum");
    expect(tableAggregateKind("平均")).toBe("average");
    expect(tableAggregateKind("個数")).toBe("count");
    expect(tableAggregateKind("合 計")).toBeNull();
    expect(tableAggregateKind("total")).toBeNull();
  });

  it("parses finite numbers with commas and rejects blanks and non-numeric values", () => {
    expect(parseTableNumber(" 1,234.5 ")).toBe(1234.5);
    expect(parseTableNumber("-2")).toBe(-2);
    expect(parseTableNumber("")).toBeNull();
    expect(parseTableNumber("項目")).toBeNull();
    expect(parseTableNumber("Infinity")).toBeNull();
  });

  it("calculates multiple aggregate rows vertically without including aggregate rows", () => {
    const result = calculateTableAggregates({
      headers: ["項目", "金額", "数量", "備考"],
      rows: [
        ["A", "1,000", "2", "対象"],
        ["B", "-200.5", "", "対象外"],
        ["合計", "999", "999", "old"],
        ["平均", "", "", ""],
        ["個数", "", "", ""],
      ],
    });

    expect(result.rows).toEqual([
      ["A", "1,000", "2", "対象"],
      ["B", "-200.5", "", "対象外"],
      ["合計", "799.5", "2", "0"],
      ["平均", "399.75", "2", ""],
      ["個数", "2", "1", "0"],
    ]);
  });

  it("calculates aggregate columns horizontally and marks unlike row-column intersections", () => {
    const result = calculateTableAggregates({
      headers: ["項目", "値1", "合計", "値2", "平均", "個数"],
      rows: [
        ["A", "1", "old", "3", "old", "old"],
        ["B", "x", "old", "", "old", "old"],
        ["合計", "10", "old", "20", "old", "old"],
      ],
    });

    expect(result.rows).toEqual([
      ["A", "1", "4", "3", "2", "2"],
      ["B", "x", "0", "", "", "0"],
      ["合計", "1", "4", "3", "-", "-"],
    ]);
    expect(isTableAggregateResultCell(result, 0, 2)).toBe(true);
    expect(isTableAggregateResultCell(result, 2, 1)).toBe(true);
    expect(isTableAggregateResultCell(result, 0, 1)).toBe(false);
  });

  it("calculates matching aggregate intersections from all non-aggregate data cells", () => {
    const result = calculateTableAggregates({
      headers: ["項目", "値1", "値2", "合計", "平均", "個数"],
      rows: [
        ["A", "1", "3", "", "", ""],
        ["B", "5", "x", "", "", ""],
        ["合計", "", "", "", "", ""],
        ["平均", "", "", "", "", ""],
        ["個数", "", "", "", "", ""],
      ],
    });

    expect(result.rows[2].slice(3)).toEqual(["9", "-", "-"]);
    expect(result.rows[3].slice(3)).toEqual(["-", "3", "-"]);
    expect(result.rows[4].slice(3)).toEqual(["-", "-", "3"]);
  });

  it("uses a header label in the first column as a horizontal aggregate column", () => {
    const result = calculateTableAggregates({
      headers: ["合計", "値1", "値2"],
      rows: [["old", "0.1", "0.2"]],
    });

    expect(result.rows).toEqual([["0.3", "0.1", "0.2"]]);
  });
});
