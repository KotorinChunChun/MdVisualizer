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
    const { container } = render(<MarkdownEditor ref={ref} documentId="tab-1:1" value={"one\ntwo\nthree"} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} onActiveLineChange={onActiveLineChange} />);
    act(() => ref.current?.focusLine(3));

    await waitFor(() => expect(container.querySelector(".cm-activeLine")?.textContent).toBe("three"));
    expect(onActiveLineChange).toHaveBeenLastCalledWith(3);
    expect(ref.current?.contains(document.activeElement)).toBe(true);
  });

  it("applies toolbar edits to the draft callback", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="tab-1:1" value="# Test" dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "太字" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("**太字**# Test"));
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
