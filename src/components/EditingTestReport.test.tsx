import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITING_TEST_CASES, type EditingTestCase } from "../lib/editingTestCases";
import { EditingTestReport } from "./EditingTestReport";

afterEach(cleanup);

describe("EditingTestReport", () => {
  it("指定レイアウトの表と全件成功の集計を表示する", () => {
    render(<EditingTestReport onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Markdown編集テスト結果" })).toBeTruthy();
    expect(screen.getByText(`${EDITING_TEST_CASES.length} / ${EDITING_TEST_CASES.length} 成功`)).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "入力前テキスト（カーソル位置に目印を表示）" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "入力するキー" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "変更後テキスト" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "テスト結果" })).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    expect(screen.getByText(`1 / ${Math.ceil(EDITING_TEST_CASES.length / 100)}ページ`)).toBeTruthy();
  });

  it("100件ずつページを切り替える", () => {
    render(<EditingTestReport onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "次の100件" }));
    expect(screen.getByText(`2 / ${Math.ceil(EDITING_TEST_CASES.length / 100)}ページ`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前の100件" }));
    expect(screen.getByText(`1 / ${Math.ceil(EDITING_TEST_CASES.length / 100)}ページ`)).toBeTruthy();
  });

  it("分類と検索語で結果を絞り込む", () => {
    render(<EditingTestReport onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("分類"), { target: { value: "削除" } });
    const deleteCount = EDITING_TEST_CASES.filter((testCase) => testCase.category === "削除").length;
    expect(screen.getByText(`${deleteCount}件を表示`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("検索"), { target: { value: "CRLF" } });
    const crlfDeleteCount = EDITING_TEST_CASES.filter((testCase) => testCase.category === "削除" && [testCase.description, testCase.key, testCase.before, testCase.expectedAfter].some((value) => value.toLocaleLowerCase("ja").includes("crlf".toLocaleLowerCase("ja")))).length;
    expect(screen.getByText(`${crlfDeleteCount}件を表示`)).toBeTruthy();
  });

  it("選択ケースの入力、キー、期待値、実際値を再現する", () => {
    render(<EditingTestReport onClose={() => {}} cases={[EDITING_TEST_CASES[0]]} />);

    fireEvent.click(screen.getByRole("button", { name: "再現" }));
    const reproduction = screen.getByRole("region", { name: "選択ケースの再現結果" });
    expect(within(reproduction).getByText(EDITING_TEST_CASES[0].description)).toBeTruthy();
    expect(within(reproduction).getByText(EDITING_TEST_CASES[0].key, { selector: "kbd" })).toBeTruthy();
    fireEvent.click(within(reproduction).getByRole("button", { name: "このケースを再実行" }));
    expect(screen.getByText("1 / 1 成功")).toBeTruthy();
  });

  it("失敗の実際値と期待値との差異を表示する", () => {
    const failing: EditingTestCase = { ...EDITING_TEST_CASES[0], expectedAfter: "期待値" };
    render(<EditingTestReport onClose={() => {}} cases={[failing]} />);

    expect(screen.getByText("0 / 1 成功")).toBeTruthy();
    expect(screen.getByText("失敗")).toBeTruthy();
    fireEvent.click(screen.getByText("期待値との差異"));
    expect(screen.getByText("期待値")).toBeTruthy();
  });

  it("閉じる操作を通知する", () => {
    const onClose = vi.fn();
    render(<EditingTestReport onClose={onClose} cases={[EDITING_TEST_CASES[0]]} />);

    fireEvent.click(screen.getByRole("button", { name: "編集テスト結果を閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
