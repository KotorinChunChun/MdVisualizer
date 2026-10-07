import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { EditorView } from "@codemirror/view";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);
const img = (letter = "A", caption = "") => `![${caption}](data:image/png;base64,${letter.repeat(2048)})`;
function mount(value = "", id = "natural:1") {
  const ref = createRef<MarkdownEditorHandle>();
  const onChange = vi.fn();
  const props = { ref, documentId: id, dirty: false, saving: false, onChange, onSave: () => {} };
  const result = render(<MarkdownEditor {...props} value={value} />);
  const view = () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)!;
  return { ...result, ref, onChange, props, view };
}
function paste(container: HTMLElement, text: string) {
  fireEvent.paste(container.querySelector<HTMLElement>(".cm-content")!, {
    clipboardData: { files: [], items: [], getData: () => text },
  });
}
const folds = (container: HTMLElement) => container.querySelectorAll(".cm-foldPlaceholder").length;
const ranges = (view: EditorView) => {
  const result: { from: number; to: number }[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { result.push({ from, to }); });
  return result;
};
function expandFirst(view: EditorView) { act(() => view.dispatch({ effects: unfoldEffect.of(ranges(view)[0]) })); }

describe("第1組 コード画像折畳の連続操作", () => {
  it("B01-E01 画像の貼付→Undo→Redoでデータと折畳状態が戻る", async () => {
    const t = mount();
    paste(t.container, img());
    await waitFor(() => expect(folds(t.container)).toBe(1));
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe("");
    act(() => { expect(t.ref.current!.undo(true)).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img());
    expect(folds(t.container)).toBe(1);
  });
  it("B01-E02 連続した2回の貼付は1回ずつUndoできる", async () => {
    const t = mount();
    paste(t.container, img());
    await waitFor(() => expect(folds(t.container)).toBe(1));
    paste(t.container, "\n" + img("B"));
    await waitFor(() => expect(folds(t.container)).toBe(2));
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img());
    expect(folds(t.container)).toBe(1);
    act(() => { expect(t.ref.current!.undo(true)).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img() + "\n" + img("B"));
    expect(folds(t.container)).toBe(2);
  });
  it("B01-E03 文字列選択を画像で置換しても前後の本文が残りUndoで元に戻る", async () => {
    const t = mount("前\n置換対象\n後");
    act(() => t.view().dispatch({ selection: { anchor: 2, head: 6 } }));
    paste(t.container, img());
    await waitFor(() => expect(folds(t.container)).toBe(1));
    expect(t.ref.current!.snapshot()!.content).toBe("前\n" + img() + "\n後");
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe("前\n置換対象\n後");
  });
  it("B01-E04 AIの差分採用で埋め込み画像を挿入した場合も最初から折畳む", () => {
    const t = mount("前\n後");
    const base = { ...t.ref.current!.snapshot()!, from: 2, to: 2 };
    act(() => { expect(t.ref.current!.applyProposal(base, img() + "\n")).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe("前\n" + img() + "\n後");
    expect(folds(t.container)).toBe(1);
  });
  it("B01-E05 外部編集で折畳中の画像データ全体を差し替えても折畳を維持する", () => {
    const t = mount(img());
    expect(folds(t.container)).toBe(1);
    t.rerender(<MarkdownEditor {...t.props} value={img("B")} />);
    expect(t.ref.current!.snapshot()!.content).toBe(img("B"));
    expect(folds(t.container)).toBe(1);
  });
  it("B01-E06 コードを非表示にした間の画像挿入も戻ったとき折畳み表示される", () => {
    const t = mount("前\n後");
    t.rerender(<MarkdownEditor {...t.props} hidden value={"前\n後"} />);
    t.rerender(<MarkdownEditor {...t.props} hidden value={"前\n" + img() + "\n後"} />);
    t.rerender(<MarkdownEditor {...t.props} value={"前\n" + img() + "\n後"} />);
    expect(folds(t.container)).toBe(1);
    expect(t.ref.current!.snapshot()!.content).toBe("前\n" + img() + "\n後");
  });
  it("B01-E07 折畳画像の全選択削除→Undoで画像データを完全に復元する", () => {
    const t = mount("前\n" + img() + "\n後");
    act(() => t.view().dispatch({ changes: { from: 0, to: t.view().state.doc.length }, userEvent: "delete.selection" }));
    expect(t.ref.current!.snapshot()!.content).toBe("");
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe("前\n" + img() + "\n後");
    expect(folds(t.container)).toBe(1);
  });
  it("B01-E08 CRLF文書へ画像2枚と空行を貼っても保存用本文の改行が混在しない", () => {
    const t = mount("前\r\n後");
    act(() => t.view().dispatch({ selection: { anchor: 2 } }));
    paste(t.container, img() + "\n\n" + img("B") + "\n");
    expect(t.onChange).toHaveBeenLastCalledWith("前\r\n" + img() + "\r\n\r\n" + img("B") + "\r\n後");
    expect(folds(t.container)).toBe(2);
  });
  it("B01-E09 折畳画像のある文書から同じ長さの別文書へ切替えても画像と履歴が漏れない", () => {
    const t = mount(img());
    t.rerender(<MarkdownEditor {...t.props} documentId="natural:other" value={"文".repeat(img().length)} />);
    expect(folds(t.container)).toBe(0);
    expect(t.ref.current!.snapshot()!.content).toBe("文".repeat(img().length));
    act(() => { expect(t.ref.current!.undo()).toBe(false); });
  });
  it("B01-E10 手動展開した画像を追加画像のUndo/Redoで勝手に閉じない", () => {
    const t = mount(img());
    expandFirst(t.view());
    act(() => t.view().dispatch({ selection: { anchor: img().length } }));
    paste(t.container, "\n" + img("B"));
    expect(ranges(t.view())).toHaveLength(1);
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img());
    expect(ranges(t.view())).toHaveLength(0);
    act(() => { expect(t.ref.current!.undo(true)).toBe(true); });
    expect(ranges(t.view())).toHaveLength(1);
    expect(ranges(t.view())[0].from).toBeGreaterThan(img().length);
  });
  it("B01-E11 手動展開画像のbody更新と通常追記で再折畳しない", () => {
    const t = mount(img());
    expandFirst(t.view());
    t.rerender(<MarkdownEditor {...t.props} value={img("B")} />);
    expect(ranges(t.view())).toHaveLength(0);
    t.rerender(<MarkdownEditor {...t.props} value={img("B") + "\n追記"} />);
    expect(ranges(t.view())).toHaveLength(0);
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img("B"));
    expect(ranges(t.view())).toHaveLength(0);
  });
  it("B01-E12 折畳画像のcaption編集とUndo/Redoは本文と折畳を保つ", () => {
    const t = mount(img("A", "旧"));
    act(() => t.view().dispatch({ changes: { from: 2, to: 3, insert: "新しい説明" }, userEvent: "input.type", annotations: isolateHistory.of("full") }));
    expect(t.ref.current!.snapshot()!.content).toBe(img("A", "新しい説明"));
    expect(ranges(t.view())).toHaveLength(1);
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img("A", "旧"));
    expect(ranges(t.view())).toHaveLength(1);
    act(() => { expect(t.ref.current!.undo(true)).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img("A", "新しい説明"));
    expect(ranges(t.view())).toHaveLength(1);
  });
  it("B01-E13 画像を別画像で置換してUndo/Redoしても各画像を折畳む", () => {
    const t = mount(img());
    act(() => t.view().dispatch({ selection: { anchor: 0, head: img().length } }));
    paste(t.container, img("B"));
    expect(t.ref.current!.snapshot()!.content).toBe(img("B"));
    expect(ranges(t.view())).toHaveLength(1);
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img());
    expect(ranges(t.view())).toHaveLength(1);
    act(() => { expect(t.ref.current!.undo(true)).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(img("B"));
    expect(ranges(t.view())).toHaveLength(1);
  });
  it("B01-E14 同一行2画像は片方の展開と他方body更新を独立して保つ", () => {
    const t = mount(img() + " " + img("B"));
    expandFirst(t.view());
    t.rerender(<MarkdownEditor {...t.props} value={img() + " " + img("C")} />);
    expect(ranges(t.view())).toHaveLength(1);
    expect(ranges(t.view())[0].from).toBeGreaterThan(img().length);
    expect(t.ref.current!.snapshot()!.content).toBe(img() + " " + img("C"));
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(ranges(t.view())).toHaveLength(1);
    expect(ranges(t.view())[0].from).toBeGreaterThan(img().length);
  });
  it("B01-E15 大きい画像のある多行文書で通常入力をまとめてUndoしても既存表示を保つ", () => {
    const initial = img().replace("A".repeat(2048), "A".repeat(300_000)) + "\n" + img("B") + "\n" + "本文\n".repeat(2000);
    const t = mount(initial);
    expandFirst(t.view());
    const before = ranges(t.view());
    act(() => {
      const end = t.view().state.doc.length;
      t.view().dispatch({ selection: { anchor: end } });
      for (const letter of "追記") {
        const end = t.view().state.doc.length;
        t.view().dispatch({ changes: { from: end, insert: letter }, selection: { anchor: end + letter.length }, userEvent: "input.type" });
      }
    });
    expect(t.ref.current!.snapshot()!.content).toBe(initial + "追記");
    expect(ranges(t.view())).toEqual(before);
    act(() => { expect(t.ref.current!.undo()).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(initial);
    expect(ranges(t.view())).toEqual(before);
    act(() => { expect(t.ref.current!.undo(true)).toBe(true); });
    expect(t.ref.current!.snapshot()!.content).toBe(initial + "追記");
    expect(ranges(t.view())).toEqual(before);
  });
});
