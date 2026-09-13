import { useState } from "react";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DocumentDiffWorkspace, type DocumentDiffTarget } from "./DocumentDiffWorkspace";

afterEach(cleanup);
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
const target: DocumentDiffTarget = { path: "C:\\docs\\note.md", baseDir: "C:\\docs", openedContent: "a\nb\nc",
  storageContent: "a\nb\nc", editingContent: "a\nL\nc", baselineRevision: "r1", storageRevision: "r1" };
function Fixture({ storage = target.storageContent, mode = "edit", error = null, refreshing = false, onSave = () => {} }: {
  storage?: string; mode?: "edit" | "split" | "preview"; error?: string | null; refreshing?: boolean; onSave?: () => void;
}) {
  const [content, setContent] = useState(target.editingContent);
  return <><DocumentDiffWorkspace target={{ ...target, storageContent: storage, editingContent: content, storageError: error, refreshing }}
    editorMode={mode} theme="dark" onEditingChange={setContent} onSave={onSave} />
    <output data-testid="draft">{content}</output></>;
}
const draft = () => screen.getByTestId("draft").textContent;
const choose = (side: "ストレージ" | "自分") => fireEvent.click(screen.getByRole("button", { name: new RegExp(`${side}側の2行目を採用`) }));
const save = () => screen.getByRole<HTMLButtonElement>("button", { name: "採用結果を保存" });
const editor = () => EditorView.findFromDOM(document.querySelector('[data-pane-key="result"] .cm-editor')!)!;

describe("Diffの選択と編集履歴", () => {
  it.each(["edit", "split", "preview"] as const)("%sでも外部更新で2列から3列へ切り替え、自分の内容を保持する", (mode) => {
    const { rerender } = render(<Fixture mode={mode} />);
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(mode === "preview" ? 0 : 2);
    expect(document.querySelectorAll(".diff-previews__columns > article")).toHaveLength(mode === "edit" ? 0 : 2);
    rerender(<Fixture mode={mode} storage={"a\nS\nc"} />);
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(mode === "preview" ? 0 : 3);
    expect(document.querySelectorAll(".diff-previews__columns > article")).toHaveLength(mode === "edit" ? 0 : 3);
    expect(screen.getByText(/3-way（ストレージ/)).toBeTruthy();
    if (mode !== "preview") expect(document.querySelector('[data-pane-key="base"] .cm-content')?.textContent).toBe("abc");
    expect(draft()).toBe("a\nL\nc");
    expect(save().disabled).toBe(true);
    expect(document.querySelectorAll('.cm-content[contenteditable="true"]')).toHaveLength(mode === "preview" ? 0 : 1);
  });
  it("行の両側を採用でき、本文と判断をUndo/Redoし、明示保存まで書き込まない", () => {
    const onSave = vi.fn();
    render(<Fixture storage={"a\nS\nc"} onSave={onSave} />);
    choose("ストレージ");
    expect(draft()).toBe("a\nS\nc");
    expect(save().disabled).toBe(false);
    choose("自分");
    expect(draft()).toBe("a\nL\nc");
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(draft()).toBe("a\nS\nc");
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(draft()).toBe("a\nL\nc");
    expect(save().disabled).toBe(true);
    fireEvent.keyDown(document.querySelector(".document-diff-workspace")!, { key: "y", ctrlKey: true });
    expect(draft()).toBe("a\nS\nc");
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledOnce();
  });
  it("直接編集を手動採用とし、その編集と判断をUndoで戻す", () => {
    render(<Fixture storage={"a\nS\nc"} />);
    act(() => { editor().dispatch({ changes: { from: 2, to: 3, insert: "manual" } }); });
    expect(draft()).toBe("a\nmanual\nc");
    expect(save().disabled).toBe(false);
    expect(screen.getByRole("button", { name: /ストレージ側の2行目を採用.*手動編集/ })).toBeTruthy();
    fireEvent.keyDown(editor().contentDOM, { key: "z", ctrlKey: true });
    expect(draft()).toBe("a\nL\nc");
    expect(save().disabled).toBe(true);
  });
  it("再外部更新は影響行だけ判断を無効にし、採用結果と自分の原文を保持する", () => {
    const { rerender } = render(<Fixture storage={"a\nS\nT"} />);
    choose("自分");
    fireEvent.click(screen.getByRole("button", { name: /ストレージ側の3行目を採用/ }));
    expect(save().disabled).toBe(false);
    rerender(<Fixture storage={"a\nS2\nT"} />);
    expect(draft()).toBe("a\nL\nT");
    expect(screen.getByText("未選択 1行")).toBeTruthy();
    expect(document.querySelector('[data-pane-key="base"] .cm-content')?.textContent).toBe("abc");
    expect(screen.getByRole("button", { name: /ストレージ側の3行目を採用/ }).getAttribute("aria-pressed")).toBe("true");
    choose("自分");
    expect(save().disabled).toBe(false);
  });
  it("2wayへ戻って再度3wayになった時点で自分の原文を採り直す", () => {
    const { rerender } = render(<Fixture storage={"a\nS\nc"} />);
    rerender(<Fixture />);
    act(() => { editor().dispatch({ changes: { from: 2, to: 3, insert: "L2" } }); });
    rerender(<Fixture storage={"a\nS2\nc"} />);
    expect(document.querySelector('[data-pane-key="base"] .cm-content')?.textContent).toBe("abc");
  });
  it.each([{ refreshing: true }, { error: "ファイルが削除されました" }])("確認中・取得失敗でも本文を保持し採用と保存を禁止する %j", (props) => {
    const { rerender } = render(<Fixture storage={"a\nS\nc"} />);
    choose("自分");
    rerender(<Fixture storage={"a\nS\nc"} {...props} />);
    expect(save().disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /ストレージ側の2行目を採用/ }).disabled).toBe(true);
    expect(draft()).toBe("a\nL\nc");
  });
  it("対応行のスクロール位置を全列へ同じピクセル数で伝える", () => {
    render(<Fixture storage={"a\nS\nc"} />);
    const scrollers = [...document.querySelectorAll<HTMLElement>(".cm-scroller, .diff-row-actions")];
    scrollers[0].scrollTop = 44;
    fireEvent.scroll(scrollers[0]);
    expect(scrollers.every((node) => node.scrollTop === 44)).toBe(true);
  });
  it("編集/閲覧時だけプレビューを常時表示し、境界にはキーボードで識別できるドラッグハンドルを置く", () => {
    render(<Fixture mode="split" storage={"a\nS\nc"} />);
    expect(document.querySelector(".diff-previews")).toBeTruthy();
    expect(screen.getAllByRole("separator")).toHaveLength(5);
  });
});
