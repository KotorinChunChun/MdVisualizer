import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

describe("CodeBlock", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies only code text and emits a success notification", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const listener = vi.fn();
    window.addEventListener("markdown-toast", listener);
    render(<CodeBlock className="language-typescript">{"const answer = 42;\n"}</CodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const answer = 42;"));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { type: "success", message: "コードをコピーしました" } }));
    window.removeEventListener("markdown-toast", listener);
  });

  it("emits an error notification when the clipboard rejects the copy", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const listener = vi.fn();
    window.addEventListener("markdown-toast", listener);
    render(<CodeBlock className="language-json">{"{\"ok\":true}"}</CodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { type: "error", message: "コードをコピーできませんでした" } })));
    window.removeEventListener("markdown-toast", listener);
  });
});
