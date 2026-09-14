import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview code fences", () => {
  afterEach(cleanup);

  it("shows the copy action for a fenced block without a language", () => {
    render(<MarkdownPreview content={"```\nplain text\n```"} baseDir="C:\\docs" imageVersions={{}} />);
    expect(screen.getByRole("button", { name: "コピー" })).toBeTruthy();
    expect(screen.getByText("plain text")).toBeTruthy();
  });

  it("edits an unlabeled fenced block through the Markdown occurrence callback", async () => {
    const onCodeFenceBodyChange = vi.fn().mockResolvedValue(true);
    render(<MarkdownPreview content={"```\nold value\n```"} baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onCodeFenceBodyChange={onCodeFenceBodyChange} />);
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.change(screen.getByRole("textbox", { name: "コード" }), { target: { value: "new value" } });
    fireEvent.click(screen.getByRole("button", { name: "反映" }));
    await waitFor(() => expect(onCodeFenceBodyChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "code-fence" }), "new value"));
  });

  it("renders SVG fences with the shared SVG toolbar", () => {
    const source = "```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\"><text>図</text><script>bad()</script></svg>\n```";
    const { container } = render(<MarkdownPreview content={source} baseDir="" imageVersions={{}} />);
    expect(container.querySelector(".drawio-block")).not.toBeNull();
    expect(screen.getByRole("toolbar", { name: "draw.ioブロック操作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "コードテキストをコピー" })).toBeTruthy();
  });

  it("opens the shared SVG editor for an editable SVG fence", () => {
    const onCodeFenceBodyChange = vi.fn();
    const source = "```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\"><text>図</text></svg>\n```";
    render(<MarkdownPreview content={source} baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onCodeFenceBodyChange={onCodeFenceBodyChange} />);
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    expect(screen.getByRole("dialog", { name: "draw.io図の編集" })).toBeTruthy();
  });
});
