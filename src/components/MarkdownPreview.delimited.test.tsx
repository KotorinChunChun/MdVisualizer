import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview delimited tables", () => {
  afterEach(cleanup);

  it("renders every table with the slicer off and identifies the edited fence occurrence", () => {
    const first = "```csv\nname,value\nfirst,1\n```";
    const second = "```csv\nname,value\nsecond,2\n```";
    const content = `${first}\n\n${second}`;
    const onCodeFenceBodyChange = vi.fn().mockReturnValue(true);
    render(<MarkdownPreview content={content} baseDir="C:\\docs" imageVersions={{}} onCodeFenceBodyChange={onCodeFenceBodyChange} />);

    const paneButtons = screen.getAllByRole("button", { name: "スライサー" });
    expect(paneButtons).toHaveLength(2);
    expect(paneButtons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false"]);

    fireEvent.click(screen.getAllByRole("button", { name: "表を編集" })[1]);
    const dialog = screen.getByRole("dialog", { name: "表を編集" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "行 1 列 1" }), { target: { value: "changed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "反映" }));

    expect(onCodeFenceBodyChange).toHaveBeenCalledTimes(1);
    expect(onCodeFenceBodyChange.mock.calls[0][0]).toMatchObject({ kind: "code-fence", start: content.indexOf(second), expected: second });
    expect(onCodeFenceBodyChange.mock.calls[0][1]).toBe("name,value\nchanged,2");
  });
});
