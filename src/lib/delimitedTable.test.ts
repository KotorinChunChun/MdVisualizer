import { describe, expect, it } from "vitest";
import { compareDelimitedValues, isDelimitedTableLanguage, parseDelimitedTable, serializeDelimitedTable } from "./delimitedTable";

describe("delimited tables", () => {
  it("recognizes all four supported fence languages", () => {
    expect(["csv", "csv-h", "tsv", "tsv-h"].every(isDelimitedTableLanguage)).toBe(true);
    expect(isDelimitedTableLanguage("text")).toBe(false);
  });

  it("treats the first row as headers for CSV and preserves quoted values", () => {
    const data = parseDelimitedTable('name,note\r\nAlice,"hello, world"\r\nBob,"line 1\nline 2"', "csv");
    expect(data.headers).toEqual(["name", "note"]);
    expect(data.rows).toEqual([["Alice", "hello, world"], ["Bob", "line 1\nline 2"]]);
    expect(serializeDelimitedTable(data)).toBe('name,note\nAlice,"hello, world"\nBob,"line 1\nline 2"');
  });

  it("normalizes ragged TSV rows and supplies empty header names", () => {
    const data = parseDelimitedTable("\tvalue\nA\t1\textra\nB", "tsv-h");
    expect(data.headers).toEqual(["列 1", "value", "列 3"]);
    expect(data.rows).toEqual([["A", "1", "extra"], ["B", "", ""]]);
  });

  it("rejects an unterminated quoted cell", () => {
    expect(() => parseDelimitedTable('name,note\nAlice,"broken', "csv")).toThrow("閉じられていません");
  });

  it("sorts numeric values numerically and text naturally", () => {
    expect(compareDelimitedValues("10", "2")).toBeGreaterThan(0);
    expect(["項目10", "項目2"].sort(compareDelimitedValues)).toEqual(["項目2", "項目10"]);
  });
});
