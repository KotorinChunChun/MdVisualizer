import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(cleanup);

describe("MarkdownEditor", () => {
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
});
