import { describe, expect, it } from "vitest";
import {
  EDITING_TEST_CASES,
  executeEditingTestCase,
  runEditingTestCases,
  type EditingTestCase,
} from "./editingTestCases";

describe("Markdown編集パターン", () => {
  it("重複しない100件以上の明示的なケースを保持する", () => {
    expect(EDITING_TEST_CASES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(EDITING_TEST_CASES.map((testCase) => testCase.id)).size).toBe(EDITING_TEST_CASES.length);
    expect(new Set(EDITING_TEST_CASES.map((testCase) => testCase.category)).size).toBeGreaterThanOrEqual(10);
  });

  it.each(EDITING_TEST_CASES)("$id: $description", (testCase) => {
    expect(executeEditingTestCase(testCase)).toMatchObject({
      passed: true,
      actualAfter: testCase.expectedAfter,
    });
  });

  it("失敗時に期待値と実際値を結果へ残す", () => {
    const failing: EditingTestCase = {
      ...EDITING_TEST_CASES[0],
      id: "intentional-failure",
      expectedAfter: "異なる期待値",
    };
    expect(executeEditingTestCase(failing)).toMatchObject({
      passed: false,
      expectedAfter: "異なる期待値",
      actualAfter: "a",
    });
  });

  it("全件実行結果を定義順で返す", () => {
    const results = runEditingTestCases();
    expect(results).toHaveLength(EDITING_TEST_CASES.length);
    expect(results.map((result) => result.id)).toEqual(EDITING_TEST_CASES.map((testCase) => testCase.id));
  });
});

