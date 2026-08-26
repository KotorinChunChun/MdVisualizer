import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(cleanup);

describe("MarkdownEditor", () => {
  it("moves focus and the cursor to a requested source line through its imperative API", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onActiveLineChange = vi.fn();
    const onCursorPositionChange = vi.fn();
    const { container } = render(<MarkdownEditor ref={ref} documentId="tab-1:1" value={"one\ntwo\nthree"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} onActiveLineChange={onActiveLineChange} onCursorPositionChange={onCursorPositionChange} />);
    act(() => ref.current?.focusLine(3));

    await waitFor(() => expect(container.querySelector(".cm-activeLine")?.textContent).toBe("three"));
    expect(onActiveLineChange).toHaveBeenLastCalledWith(3);
    await waitFor(() => expect(onCursorPositionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      line: 3,
      remainingScroll: 0,
      viewportHeight: 0,
    })));
    expect(Number.isFinite(onCursorPositionChange.mock.lastCall?.[0].screenY)).toBe(true);
    expect(ref.current?.contains(document.activeElement)).toBe(true);
  });

  it("reports pure Edit-pane scrolling separately from cursor movement", () => {
    const onScrollLine = vi.fn();
    const { container } = render(<MarkdownEditor documentId="tab-1:1" value={"one\ntwo\nthree"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} onScrollLine={onScrollLine} />);

    fireEvent.scroll(container.querySelector(".cm-scroller")!);

    expect(onScrollLine).toHaveBeenCalledWith(1);
  });

  it("applies toolbar edits to the draft callback", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="tab-1:1" value="# Test" dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "太字" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("**太字**# Test"));
  });

  it("disables block insertion buttons while the cursor is inside a table", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor ref={ref} documentId="table-context:1" value={"| A | B |\n| --- | --- |\n| one | two |\n\noutside"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);

    act(() => ref.current?.focusLine(3));

    await waitFor(() => expect((screen.getByRole("button", { name: "表を挿入" }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Mermaid図を挿入" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "draw.io図を挿入" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "画像を挿入" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("inserts a block after the closing fence when the cursor is inside code", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    render(<MarkdownEditor ref={ref} documentId="fence-context:1" value={"```typescript\nconst value = 1;\n```\nafter"} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);

    act(() => ref.current?.focusLine(2));
    fireEvent.click(screen.getByRole("button", { name: "Mermaid図を挿入" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const output = onChange.mock.lastCall?.[0] as string;
    expect(output.indexOf("```mermaid")).toBeGreaterThan(output.indexOf("const value = 1;"));
    expect(output.indexOf("```mermaid")).toBeLessThan(output.indexOf("after"));
  });

  it("enables saving only for an unsaved draft", () => {
    const onSave = vi.fn();
    const { rerender } = render(<MarkdownEditor documentId="tab-1:1" value="# Test" dirty={false} saving={false} onChange={() => {}} onSave={onSave} />);
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<MarkdownEditor documentId="tab-1:1" value="# Edited" dirty saving={false} onChange={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledOnce();
  });

  it("reflects an externally edited Base64 occurrence in CodeMirror without emitting another change", async () => {
    const onChange = vi.fn();
    const original = "![photo](data:image/png;base64,ORIGINAL)";
    const edited = "![photo](data:image/png;base64,EDITED)";
    const { container, rerender } = render(<MarkdownEditor documentId="tab-1:1" value={original} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);

    rerender(<MarkdownEditor documentId="tab-1:1" value={edited} dirty saving={false} onChange={onChange} onSave={() => {}} />);

    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("EDITED"));
    expect(container.querySelector(".cm-content")?.textContent).not.toContain("ORIGINAL");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggles list states from shortcuts at the current cursor", async () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor documentId="tab-1:1" value="item" dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);
    const editor = container.querySelector<HTMLElement>(".cm-content")!;

    fireEvent.keyDown(editor, { key: "]", ctrlKey: true });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("- [x] item"));
  });

  it("continues an ordered list with Enter", async () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor documentId="tab-1:1" value="1. item" dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);
    const editor = container.querySelector<HTMLElement>(".cm-content")!;

    fireEvent.keyDown(editor, { key: "End" });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("1. item\n2. "));
  });

  it("repairs mixed line endings using the predominant document format", async () => {
    const onChange = vi.fn();
    const onLineEndingsNormalized = vi.fn();
    const mixed = "one\r\ntwo\nthree\r\nfour";
    const { container } = render(<MarkdownEditor documentId="mixed:1" value={mixed} dirty={false} saving={false} onChange={onChange} onSave={() => {}} onLineEndingsNormalized={onLineEndingsNormalized} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("one\r\ntwo\r\nthree\r\nfour"));
    expect(onLineEndingsNormalized).toHaveBeenCalledWith("\r\n");
    expect(container.querySelectorAll(".cm-line")).toHaveLength(4);
    expect(container.querySelector(".cm-specialChar")).toBeNull();
  });

  it("uses the inferred CRLF format for Enter", async () => {
    const onChange = vi.fn();
    const ref = createRef<MarkdownEditorHandle>();
    const { container } = render(<MarkdownEditor ref={ref} documentId="crlf-enter:1" value={"one\r\ntwo"} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);
    const editor = container.querySelector<HTMLElement>(".cm-content")!;

    act(() => ref.current?.focusLine(2));
    fireEvent.keyDown(editor, { key: "End" });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("one\r\ntwo\r\n"));
  });

  it("keeps CRLF and correct cursor positions when continuing a structured list", async () => {
    const onChange = vi.fn();
    const ref = createRef<MarkdownEditorHandle>();
    const { container } = render(<MarkdownEditor ref={ref} documentId="crlf-list-enter:1" value={"1. first\r\n2. second"} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);
    const editor = container.querySelector<HTMLElement>(".cm-content")!;

    act(() => ref.current?.focusLine(2));
    fireEvent.keyDown(editor, { key: "End" });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("1. first\r\n2. second\r\n3. "));
  });

  it("normalizes pasted LF text to a CRLF document", async () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor documentId="crlf-paste:1" value={"start\r\nend"} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);

    fireEvent.paste(container.querySelector<HTMLElement>(".cm-content")!, {
      clipboardData: { items: [], files: [], getData: () => "alpha\nbeta" },
    });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("alpha\r\nbetastart\r\nend"));
  });

  it("normalizes pasted CRLF text to an LF document", async () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor documentId="lf-paste:1" value={"start\nend"} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);

    fireEvent.paste(container.querySelector<HTMLElement>(".cm-content")!, {
      clipboardData: { items: [], files: [], getData: () => "alpha\r\nbeta" },
    });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("alpha\nbetastart\nend"));
  });

  it("inserts a clipboard image instead of its accompanying plain text", async () => {
    const onChange = vi.fn();
    const onResolvePastedImage = vi.fn().mockResolvedValue({ source: "data:image/png;base64,AAEC" });
    const { container } = render(<MarkdownEditor documentId="tab-1:1" value="before" dirty={false} saving={false} onChange={onChange} onSave={() => {}} onResolvePastedImage={onResolvePastedImage} />);
    const file = new File([new Uint8Array([0, 1, 2])], "clipboard.png", { type: "image/png" });

    fireEvent.paste(container.querySelector<HTMLElement>(".cm-content")!, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
        files: [file],
        getData: () => "text fallback",
      },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("![クリップボード画像](data:image/png;base64,AAEC)before"));
    expect(onResolvePastedImage).toHaveBeenCalledWith({ mediaType: "image/png", base64: "AAEC" });
  });

  it("registers a staged PNG with the exact content inserted into the editor", async () => {
    const onStagedAssetAdded = vi.fn();
    const asset = { id: "stage-1", filename: "images/20260824_090507.png", mediaType: "image/png", base64: "AAEC" };
    const { container } = render(<MarkdownEditor documentId="tab-1:1" value="" dirty={false} saving={false} onChange={() => {}} onSave={() => {}} onResolvePastedImage={async () => ({ source: asset.filename, asset })} onStagedAssetAdded={onStagedAssetAdded} />);
    const file = new File([new Uint8Array([0, 1, 2])], "clipboard.png", { type: "image/png" });

    fireEvent.paste(container.querySelector<HTMLElement>(".cm-content")!, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }], files: [file], getData: () => "" },
    });

    await waitFor(() => expect(onStagedAssetAdded).toHaveBeenCalledWith("![クリップボード画像](images/20260824_090507.png)", asset));
  });
});
