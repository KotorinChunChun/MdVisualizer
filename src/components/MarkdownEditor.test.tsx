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
  it("AIの選択範囲採用はCRLFを保持し、一度のUndoで戻せる", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor ref={ref} documentId="ai:1" value={"前\r\n旧文\r\n後"} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);
    const original = ref.current!.snapshot()!;
    expect(original.content).toBe("前\n旧文\n後");
    act(() => { expect(ref.current!.applyProposal({ ...original, from: 2, to: 4 }, "新文")).toBe(true); });
    expect(onChange).toHaveBeenLastCalledWith("前\r\n新文\r\n後");
    fireEvent.keyDown(container.querySelector<HTMLElement>(".cm-content")!, { key: "z", ctrlKey: true });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("前\r\n旧文\r\n後"));
  });
  it("AIの採用は本文変更・文書切替・保存中には拒否する", () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const props = { ref, documentId: "ai:1", value: "原文", dirty: false, saving: false, onChange, onSave: () => {} };
    const { rerender } = render(<MarkdownEditor {...props} />);
    const base = { ...ref.current!.snapshot()!, from: 0, to: 2 };
    rerender(<MarkdownEditor {...props} value="変更済み" />);
    expect(ref.current!.applyProposal(base, "提案")).toBe(false);
    rerender(<MarkdownEditor {...props} documentId="ai:2" />);
    expect(ref.current!.applyProposal(base, "提案")).toBe(false);
    rerender(<MarkdownEditor {...props} saving />);
    expect(ref.current!.applyProposal(base, "提案")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("highlights and refreshes changed lines when embedded in Diff", async () => {
    const { container, rerender } = render(<MarkdownEditor documentId="diff:1" value={"one\ntwo\nthree"} dirty saving={false} onChange={() => {}} onSave={() => {}} diffChangedLines={new Set([2])} />);

    await waitFor(() => expect(container.querySelector(".cm-line.cm-diff-changed-line")?.textContent).toBe("two"));

    rerender(<MarkdownEditor documentId="diff:1" value={"one\ntwo\nthree"} dirty saving={false} onChange={() => {}} onSave={() => {}} diffChangedLines={new Set([3])} />);
    await waitFor(() => {
      expect(container.querySelector(".cm-line.cm-diff-changed-line")?.textContent).toBe("three");
    });
  });

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

  it("restores the cursor for the same viewStateKey after a saved generation recreates the editor", async () => {
    const first = createRef<MarkdownEditorHandle>();
    const { rerender } = render(<MarkdownEditor ref={first} documentId="tab-1:1" viewStateKey="C:\\docs\\note.md" value={"one\ntwo\nthree"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
    act(() => first.current?.focusLine(3));
    expect(first.current?.snapshot()?.from).toBe(8);
    await waitFor(() => expect(first.current?.contains(document.activeElement)).toBe(true));

    const second = createRef<MarkdownEditorHandle>();
    rerender(<MarkdownEditor ref={second} documentId="tab-1:2" viewStateKey="C:\\docs\\note.md" value={"one\ntwo\nthree"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
    await waitFor(() => expect(second.current?.snapshot()?.from).toBe(8));
    await waitFor(() => expect(second.current?.contains(document.activeElement)).toBe(true));
  });

  it("keeps an unaffected long-code fold and both scroll axes when a save adds lines before it", async () => {
    const lines = ["```text", ...Array.from({ length: 10 }, (_, index) => `line ${index + 1}`), "```"];
    const value = lines.join("\n");
    const { container, rerender } = render(<MarkdownEditor documentId="tab-fold:1" viewStateKey="C:\\docs\\fold.md" value={value} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
    await waitFor(() => expect(container.querySelector(".cm-foldPlaceholder")).toBeTruthy());
    const scroller = container.querySelector<HTMLElement>(".cm-scroller")!;
    scroller.scrollTop = 48;
    scroller.scrollLeft = 24;

    rerender(<MarkdownEditor documentId="tab-fold:2" viewStateKey="C:\\docs\\fold.md" value={`before\n${value}`} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);

    await waitFor(() => expect(container.querySelector(".cm-foldPlaceholder")).toBeTruthy());
    const restoredScroller = container.querySelector<HTMLElement>(".cm-scroller")!;
    await waitFor(() => expect(restoredScroller.scrollTop).toBe(48));
    expect(restoredScroller.scrollLeft).toBe(24);
  });

  it("folds multiple base64 images on the same table row without blanking the editor", async () => {
    const first = "A".repeat(80);
    const second = "B".repeat(96);
    const value = `| A | B |\n| --- | --- |\n| ![a](data:image/png;base64,${first}) | ![b](data:image/svg+xml;base64,${second}) |`;
    const { container } = render(<MarkdownEditor documentId="tab-base64-row:1" value={value} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);

    await waitFor(() => expect(container.querySelectorAll(".cm-foldPlaceholder")).toHaveLength(2));
    expect(container.querySelector(".cm-content")?.textContent).toContain("A");
    expect(container.querySelector(".cm-content")?.textContent).toContain("B");
  });

  it("keeps an unaffected fold and both scroll axes on an external reload without recreating the editor", async () => {
    const value = ["```text", ...Array.from({ length: 10 }, (_, index) => `line ${index + 1}`), "```"].join("\n");
    const { container, rerender } = render(<MarkdownEditor documentId="tab-reload:1" value={value} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
    await waitFor(() => expect(container.querySelector(".cm-foldPlaceholder")).toBeTruthy());
    const scroller = container.querySelector<HTMLElement>(".cm-scroller")!;
    scroller.scrollTop = 39;
    scroller.scrollLeft = 17;

    rerender(<MarkdownEditor documentId="tab-reload:1" value={`external\n${value}`} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);

    await waitFor(() => expect(container.querySelector(".cm-foldPlaceholder")).toBeTruthy());
    await waitFor(() => expect(scroller.scrollTop).toBe(39));
    expect(scroller.scrollLeft).toBe(17);
  });

  it("reports pure Edit-pane scrolling separately from cursor movement", () => {
    const onScrollLine = vi.fn();
    const { container } = render(<MarkdownEditor documentId="tab-1:1" value={"one\ntwo\nthree"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} onScrollLine={onScrollLine} />);

    fireEvent.scroll(container.querySelector(".cm-scroller")!);

    expect(onScrollLine).toHaveBeenCalledWith(1);
  });

  it("does not propagate a programmatic view-following scroll back to the View", () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onScrollLine = vi.fn();
    const { container } = render(<MarkdownEditor ref={ref} documentId="tab-1:1" value={"one\ntwo\nthree"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} onScrollLine={onScrollLine} />);

    act(() => ref.current?.scrollToLine(3));
    fireEvent.scroll(container.querySelector(".cm-scroller")!);

    expect(onScrollLine).not.toHaveBeenCalled();
  });

  it("applies toolbar edits to the draft callback", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="tab-1:1" value="# Test" dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "太字" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("**太字**# Test"));
  });

  it("labels the compact fold action and places the horizontal rule before Mermaid", () => {
    render(<MarkdownEditor documentId="tab-1:1" value="# Test" dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
    const labels = [...screen.getByRole("toolbar", { name: "Markdown書式" }).querySelectorAll("button")].map((button) => button.textContent);
    expect(labels.indexOf("―")).toBeLessThan(labels.indexOf("+Mermaid"));
    expect(screen.getByRole("button", { name: "折畳" }).getAttribute("title")).toBe("H2以下と長いコードを折畳");
  });

  it("折畳でもH1本文と短いコードを残し、H2本文と規定行数のコードを隠す", async () => {
    const value = ["# H1", "H1本文", "", "```txt", "短いコード", "```", "", "## H2", "H2本文", "", "# 次のH1", "```txt", ...Array.from({ length: 10 }, (_, i) => `長いコード${i}`), "```"].join("\n");
    const { container } = render(<MarkdownEditor documentId="fold-heading:1" value={value} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "展開" }));
    fireEvent.click(screen.getByRole("button", { name: "折畳" }));
    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).not.toContain("H2本文"));
    expect(container.querySelector(".cm-content")?.textContent).toContain("H1本文");
    expect(container.querySelector(".cm-content")?.textContent).toContain("短いコード");
    expect(container.querySelector(".cm-content")?.textContent).not.toContain("長いコード0");
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

  it("keeps Ctrl+S while removing the duplicate code-pane save button", () => {
    const onSave = vi.fn();
    const { rerender } = render(<MarkdownEditor documentId="tab-1:1" value="# Test" dirty={false} saving={false} onChange={() => {}} onSave={onSave} />);
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    rerender(<MarkdownEditor documentId="tab-1:1" value="# Edited" dirty saving={false} onChange={() => {}} onSave={onSave} />);
    fireEvent.keyDown(document.querySelector<HTMLElement>(".cm-content")!, { key: "s", ctrlKey: true });

    expect(onSave).toHaveBeenCalledOnce();
  });

  it("inserts a relative link for a clipboard file through the host adapter before legacy image paste", async () => {
    const onChange = vi.fn();
    const onResolveFileAttachment = vi.fn().mockResolvedValue({ source: "assets/report.bin" });
    const file = new File(["binary"], "report.bin", { type: "application/octet-stream" });
    const { container } = render(<MarkdownEditor documentId="file-paste:1" value="before" dirty={false} saving={false} onChange={onChange} onSave={() => {}} onResolveFileAttachment={onResolveFileAttachment} />);
    fireEvent.paste(container.querySelector<HTMLElement>(".cm-content")!, { clipboardData: { files: [file], items: [], getData: () => "" } });
    await waitFor(() => expect(onResolveFileAttachment).toHaveBeenCalledWith(file, "link"));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("[report.bin](assets/report.bin)before"));
  });

  it("inserts an image reference for a dropped file through the host adapter", async () => {
    const onChange = vi.fn();
    const onResolveFileAttachment = vi.fn().mockResolvedValue({ source: "assets/report.bin" });
    const file = new File(["binary"], "report.bin", { type: "application/octet-stream" });
    const { container } = render(<MarkdownEditor documentId="file-drop:1" value="before" dirty={false} saving={false} onChange={onChange} onSave={() => {}} onResolveFileAttachment={onResolveFileAttachment} />);
    fireEvent.drop(container.querySelector<HTMLElement>(".cm-content")!, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onResolveFileAttachment).toHaveBeenCalledWith(file, "image"));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("![](assets/report.bin)before"));
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

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("![](data:image/png;base64,AAEC)before"));
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

    await waitFor(() => expect(onStagedAssetAdded).toHaveBeenCalledWith("![](images/20260824_090507.png)", asset));
  });

  it("prioritizes an image clipboard item over the generic file attachment handler", async () => {
    const onChange = vi.fn();
    const onResolvePastedImage = vi.fn().mockResolvedValue({ source: "data:image/png;base64,AAEC" });
    const onResolveFileAttachment = vi.fn().mockResolvedValue({ source: "clipboard.png" });
    const { container } = render(<MarkdownEditor documentId="image-priority:1" value="" dirty={false} saving={false} onChange={onChange} onSave={() => {}} onResolvePastedImage={onResolvePastedImage} onResolveFileAttachment={onResolveFileAttachment} />);
    const file = new File([new Uint8Array([0, 1, 2])], "clipboard.png", { type: "image/png" });
    fireEvent.paste(container.querySelector<HTMLElement>(".cm-content")!, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }], files: [file], getData: () => "clipboard text" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("![](data:image/png;base64,AAEC)"));
    expect(onResolveFileAttachment).not.toHaveBeenCalled();
  });

  it("inserts dropped files as image references with an optional external filename", async () => {
    const onChange = vi.fn();
    const onResolveFileAttachment = vi.fn().mockResolvedValue({ source: "assets/report.bin", alt: "report.bin" });
    const file = new File(["binary"], "report.bin", { type: "application/octet-stream" });
    const { container } = render(<MarkdownEditor documentId="image-drop:1" value="before" dirty={false} saving={false} onChange={onChange} onSave={() => {}} onResolveFileAttachment={onResolveFileAttachment} />);
    fireEvent.drop(container.querySelector<HTMLElement>(".cm-content")!, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("![report.bin](assets/report.bin)before"));
    expect(onResolveFileAttachment).toHaveBeenCalledWith(file, "image");
  });
});
