import { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { DiffCodeEditor } from "./DiffCodeEditor";
import { buildMergeRows } from "../lib/documentMerge";

afterEach(cleanup);
beforeAll(() => { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect(); });
it("矢印キーによる選択位置変更で現在行が追従し、色の意味と変更文字を保つ", () => {
  const rows = buildMergeRows("a\nb", "a\nb", "a\nB", "a\nB");
  function Fixture() { const [active, setActive] = useState<string>(); return <DiffCodeEditor value={"a\nB"} label="編集" column="result" rows={rows} readOnly={false} activeRow={active} onActivate={setActive} />; }
  const { container } = render(<Fixture />);
  const editor = container.querySelector<HTMLElement>(".cm-editor")!;
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ selection: { anchor: 1 } }));
  expect(container.querySelector(".is-current")?.textContent).toBe("a");
  fireEvent.keyDown(view.contentDOM, { key: "ArrowRight", code: "ArrowRight" });
  expect(view.state.selection.main.head).toBe(2);
  expect(container.querySelector(".is-current.is-added")?.textContent).toBe("B");
  expect(container.querySelector(".is-current .diff-word-added")?.textContent).toBe("B");
  act(() => view.dispatch({ selection: { anchor: 2, head: 3 } }));
  expect(container.querySelector(".cm-selection-range")?.textContent).toBe("B");
});
it("クリックした行を選択し、描画更新を編集として通知しない", () => {
  const onActivate = vi.fn(), onChange = vi.fn(), rows = buildMergeRows("旧", "旧", "新", "新");
  const { container, rerender } = render(<DiffCodeEditor value="新" label="編集" column="result" rows={rows} readOnly={false} onActivate={onActivate} onChange={onChange} />);
  fireEvent.click(container.querySelector(".cm-line")!);
  expect(onActivate).toHaveBeenCalledWith(rows[0].id);
  rerender(<DiffCodeEditor value="新" label="編集" column="result" rows={rows} readOnly={false} activeRow={rows[0].id} onActivate={onActivate} onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
});
