import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview Markdown tables", () => {
  afterEach(cleanup);

  it("opens the shared GUI editor from the top-right pencil and returns a safe replacement", () => {
    const content = "| name | score |\r\n| :--- | ---: |\r\n| Alice | 10 |";
    const onMarkdownTableChange = vi.fn().mockReturnValue(true);
    const { container } = render(<MarkdownPreview
      content={content}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\sample.md"
      imageVersions={{}}
      onMarkdownTableChange={onMarkdownTableChange}
    />);

    const edit = screen.getByRole("button", { name: "表を編集" });
    expect(edit.className).toContain("markdown-table-edit");
    expect(container.querySelector(".markdown-table-card > table")).toBeTruthy();
    fireEvent.click(edit);

    const dialog = screen.getByRole("dialog", { name: "表を編集" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "行 1 列 1" }), { target: { value: "A|B" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "列 1の配置" }), { target: { value: "center" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "反映" }));

    expect(onMarkdownTableChange).toHaveBeenCalledTimes(1);
    expect(onMarkdownTableChange.mock.calls[0][0]).toMatchObject({ kind: "table", expected: content, lineEnding: "\r\n" });
    expect(onMarkdownTableChange.mock.calls[0][1]).toBe("| name | score |\r\n| :---: | ---: |\r\n| A\\|B | 10 |");
    expect(screen.queryByRole("dialog", { name: "表を編集" })).toBeNull();
  });

  it("does not expose editing in read-only, static, or presentation views", () => {
    const content = "| A |\n| --- |\n| B |";
    const onMarkdownTableChange = vi.fn();
    const view = render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} onMarkdownTableChange={onMarkdownTableChange} />);
    expect(screen.queryByRole("button", { name: "表を編集" })).toBeNull();

    view.rerender(<MarkdownPreview content={content} baseDir="" documentPath="note.md" imageVersions={{}} onMarkdownTableChange={onMarkdownTableChange} staticMode />);
    expect(screen.queryByRole("button", { name: "表を編集" })).toBeNull();

    view.rerender(<MarkdownPreview content={content} baseDir="" documentPath="note.md" imageVersions={{}} onMarkdownTableChange={onMarkdownTableChange} presentationMode />);
    expect(screen.queryByRole("button", { name: "表を編集" })).toBeNull();
  });
});
