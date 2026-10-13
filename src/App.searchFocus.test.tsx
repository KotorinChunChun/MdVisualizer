import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { restoreDocumentSearchFocus } from "./lib/previewDom";
import { MarkdownEditor, type MarkdownEditorHandle } from "./components/MarkdownEditor";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("B03-E06 検索終了のfocus復帰", () => {
  it("検索をEscapeで閉じて元のEditor選択へ入力しUndoできる", () => {
    const original = "前の語句と後の語句", ref = createRef<MarkdownEditorHandle>();
    function Host() {
      const [open, setOpen] = useState(false), [value, setValue] = useState(original);
      const origin = useRef<HTMLElement | null>(null);
      const close = () => { setOpen(false); restoreDocumentSearchFocus(origin.current, () => ref.current?.focus()); };
      return <>
        {open && <input autoFocus aria-label="試験検索" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }} />}
        <MarkdownEditor ref={ref} documentId="search-focus" value={value} dirty={value !== original} saving={false} onChange={setValue} onSave={vi.fn()}
          onSearch={() => { origin.current = document.activeElement as HTMLElement; setOpen(true); }} />
      </>;
    }
    const mounted = render(<Host />);
    const editor = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>(".cm-content")!)!;
    act(() => { editor.dispatch({ selection: { anchor: 4, head: 1 } }); editor.focus(); });
    fireEvent.keyDown(editor.contentDOM, { key: "f", ctrlKey: true });
    expect(mounted.container.querySelector(".cm-search")).toBeNull();
    const query = screen.getByRole("textbox", { name: "試験検索" }); expect(document.activeElement).toBe(query);
    fireEvent.keyDown(query, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "試験検索" })).toBeNull(); expect(document.activeElement).toBe(editor.contentDOM);
    expect(editor.state.selection.main.anchor).toBe(4); expect(editor.state.selection.main.head).toBe(1);
    act(() => editor.dispatch(editor.state.replaceSelection("新"), { userEvent: "input.type" }));
    expect(editor.state.sliceDoc()).toBe(original.slice(0, 1) + "新" + original.slice(4));
    act(() => expect(ref.current!.undo()).toBe(true));
    expect(editor.state.sliceDoc()).toBe(original);
    expect(editor.state.selection.main.anchor).toBe(4); expect(editor.state.selection.main.head).toBe(1);
  });

  it.each(["removed", "disabled", "missing"])("元の入力先が%sなら現在文書のfallbackへ戻る", kind => {
    const origin = document.createElement("button"), fallback = document.createElement("textarea");
    if (kind === "disabled") origin.disabled = true;
    if (kind !== "removed") document.body.append(origin);
    document.body.append(fallback);
    const focusFallback = vi.fn(() => fallback.focus());
    try {
      restoreDocumentSearchFocus(kind === "missing" ? null : origin, focusFallback);
      expect(focusFallback).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(fallback);
    } finally { origin.remove(); fallback.remove(); }
  });
});
