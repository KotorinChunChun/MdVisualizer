import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { getSearchQuery } from "@codemirror/search";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

vi.mock("../features/codex/skills", () => ({ useCodexSkills: () => [], visibleSkills: (skills: unknown[]) => skills }));
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("B03-E06/E07 検索ショートカットのhost境界", () => {
  it("E06 host検索を一度だけ開きCodeMirror検索とwindow側へ重複配送しない", () => {
    const onSearch = vi.fn(), windowShortcut = vi.fn(), onChange = vi.fn();
    const ref = createRef<MarkdownEditorHandle>();
    const props = { documentId: "search-A", value: "前の語句と後の語句", dirty: false, saving: false, onChange, onSave: vi.fn(), onSearch };
    const mounted = render(<MarkdownEditor ref={ref} {...props} />);
    const editor = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>(".cm-content")!)!;
    act(() => { editor.dispatch({ selection: { anchor: 4, head: 1 } }); editor.focus(); });
    const before = editor.state.selection.main;
    window.addEventListener("keydown", windowShortcut);
    try { fireEvent.keyDown(editor.contentDOM, { key: "f", code: "KeyF", ctrlKey: true }); }
    finally { window.removeEventListener("keydown", windowShortcut); }
    expect(onSearch).toHaveBeenCalledOnce();
    expect(mounted.container.querySelector(".cm-search")).toBeNull();
    expect(windowShortcut).not.toHaveBeenCalled();
    expect(editor.state.sliceDoc()).toBe(props.value); expect(editor.state.selection.main).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
    act(() => expect(ref.current!.undo()).toBe(false));
  });

  it("E07 tab切替とcallback更新後は現在hostの検索だけを開く", () => {
    const searchA = vi.fn(), searchB = vi.fn(), latestB = vi.fn();
    const props = { documentId: "search-A", value: "A1 A2", dirty: false, saving: false, onChange: vi.fn(), onSave: vi.fn(), onSearch: searchA };
    const mounted = render(<MarkdownEditor {...props} />);
    const key = () => {
      const editor = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>(".cm-content")!)!;
      act(() => editor.focus()); fireEvent.keyDown(editor.contentDOM, { key: "f", ctrlKey: true });
      expect(mounted.container.querySelector(".cm-search")).toBeNull();
    };
    key();
    mounted.rerender(<MarkdownEditor {...props} documentId="search-B" value="B1 B2" onSearch={searchB} />); key();
    mounted.rerender(<MarkdownEditor {...props} documentId="search-B" value="B1 B2" onSearch={latestB} />); key();
    expect(searchA).toHaveBeenCalledOnce(); expect(searchB).toHaveBeenCalledOnce(); expect(latestB).toHaveBeenCalledOnce();
  });

  it("host検索を提供しない画面では従来のCodeMirror検索を利用できる", () => {
    const mounted = render(<MarkdownEditor documentId="standalone" value="検索対象" dirty={false} saving={false} onChange={vi.fn()} onSave={vi.fn()} />);
    const editor = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>(".cm-content")!)!;
    act(() => editor.focus()); fireEvent.keyDown(editor.contentDOM, { key: "f", ctrlKey: true });
    expect(mounted.container.querySelectorAll(".cm-search")).toHaveLength(1);
    const query = mounted.container.querySelector<HTMLInputElement>('.cm-search input[name="search"]')!;
    fireEvent.change(query, { target: { value: "検索" } });
    expect(getSearchQuery(editor.state).search).toBe("検索");
  });
});
