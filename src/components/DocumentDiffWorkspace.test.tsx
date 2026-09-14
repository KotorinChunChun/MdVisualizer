import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DocumentDiffWorkspace, type DocumentDiffTarget } from "./DocumentDiffWorkspace";

afterEach(cleanup);
it.each([false, true].flatMap(threeWay => ["single", "split"].flatMap(display => ["auto", "vertical", "horizontal"].map(direction => ({ threeWay, display, direction })))))
("差分状態 $threeWay/$display/$direction の列構成を保つ", ({ threeWay, display, direction }) => {
  render(<Fixture source={{ ...target, storageContent: threeWay ? target.storageContent : target.openedContent }} />);
  fireEvent.change(screen.getByLabelText("差分の表示"), { target: { value: display } });
  fireEvent.change(screen.getByLabelText("差分の分割方向"), { target: { value: direction } });
  if (display === "single") {
    expect(screen.getByLabelText("統合差分")).toBeTruthy();
    expect(document.querySelectorAll('.diff-columns').length).toBe(0);
  } else {
    expect(document.querySelectorAll('.diff-columns > article').length).toBe(threeWay ? 3 : 2);
    expect(document.querySelector(`.diff-columns--${direction === 'auto' ? 'vertical' : direction}`)).toBeTruthy();
  }
});
beforeAll(() => { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect(); });
const target: DocumentDiffTarget = { path: "C:\\docs\\note.md", baseDir: "C:\\docs", openedContent: "a\nb\nc", storageContent: "a\nS\nc", editingContent: "a\nL\nc", baselineRevision: "r1", storageRevision: "r2" };
function Fixture({ content = target.editingContent, source = target }: { content?: string; source?: DocumentDiffTarget }) { const [draft, setDraft] = useState(content); return <><DocumentDiffWorkspace target={{ ...source, editingContent: draft }} editorMode="edit" theme="dark" onEditingChange={setDraft} /><output data-testid="draft">{draft}</output></>; }

describe("差分の表示と採用", () => {
  it("3-wayを開始時・編集中・ストレージ順に表示する", () => {
    render(<Fixture />);
    expect([...document.querySelectorAll("[data-pane-key]")].map((node) => node.getAttribute("data-pane-key"))).toEqual(["base", "result", "storage"]);
    expect(screen.getByRole("button", { name: "開始時の2行目を復元" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ストレージの2行目を採用" })).toBeTruthy();
  });
  it("開始時の復元とストレージ採用を編集結果へ反映する", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "開始時の2行目を復元" }));
    expect(screen.getByTestId("draft").textContent).toBe("a\nb\nc");
    fireEvent.click(screen.getByRole("button", { name: "ストレージの2行目を採用" }));
    expect(screen.getByTestId("draft").textContent).toBe("a\nS\nc");
  });
  it("自動は上下、選択で左右と1画面の比較対象を切り替える", () => {
    render(<Fixture />);
    expect(document.querySelector(".diff-columns--vertical")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("差分の分割方向"), { target: { value: "horizontal" } });
    expect(document.querySelector(".diff-columns--horizontal")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("差分の表示"), { target: { value: "single" } });
    expect(screen.getByLabelText("1画面の比較対象")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("1画面の比較対象"), { target: { value: "base-result" } });
    expect(screen.getByLabelText("統合差分").textContent).toContain("- b\n+ L");
  });
  it("2-wayでも1画面は編集中とストレージの統合差分を表示する", () => {
    const source = { ...target, openedContent: "S", storageContent: "S" };
    render(<Fixture source={source} content="L" />);
    fireEvent.change(screen.getByLabelText("差分の表示"), { target: { value: "single" } });
    expect(document.querySelector(".diff-columns")).toBeNull();
    expect(screen.queryByLabelText("1画面の比較対象")).toBeNull();
    expect(screen.getByLabelText("統合差分").textContent).toContain("- L\n+ S");
  });
  it("5行以上の一致部分をまとめ、クリックで展開する", () => {
    const source = { ...target, openedContent: "a\nb\nc\nd\ne\nf\ng\nh", storageContent: "a\nS\nc\nd\ne\nf\ng\nh" };
    render(<Fixture source={source} content={"a\nL\nc\nd\ne\nf\ng\nh"} />);
    expect(screen.getByRole("button", { name: /一致部分 6 行を表示/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /一致部分 6 行を表示/ }));
    expect(screen.queryByRole("button", { name: /一致部分 6 行を表示/ })).toBeNull();
  });
});
