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
    fireEvent.click(within(dialog).getByRole("button", { name: "列 1を左揃え" }));
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

  it("renders aggregate results and serializes them when applying the table", () => {
    const content = "| 項目 | 値1 | 値2 | 合計 |\n| --- | ---: | ---: | ---: |\n| A | 10 | 20 | old |\n| B | 5 | x | old |\n| 合計 | old | old | old |";
    const onMarkdownTableChange = vi.fn().mockReturnValue(true);
    const { container } = render(<MarkdownPreview
      content={content}
      baseDir=""
      documentPath="note.md"
      imageVersions={{}}
      onMarkdownTableChange={onMarkdownTableChange}
    />);
    const rows = container.querySelectorAll(".markdown-table-card > table tbody tr");

    expect(rows[0].textContent).toBe("A102030");
    expect(rows[1].textContent).toBe("B5x5");
    expect(rows[2].textContent).toBe("合計152035");

    fireEvent.click(screen.getByRole("button", { name: "表を編集" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "表を編集" })).getByRole("button", { name: "反映" }));
    expect(onMarkdownTableChange.mock.calls[0][1]).toContain("| A | 10 | 20 | 30 |");
    expect(onMarkdownTableChange.mock.calls[0][1]).toContain("| 合計 | 15 | 20 | 35 |");
  });
});
