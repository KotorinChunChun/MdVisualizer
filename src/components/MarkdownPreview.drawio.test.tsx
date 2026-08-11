import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("./DrawioBlock", () => ({
  DrawioBlock: ({ source, onSave }: { source: string; onSave?: (source: string) => void }) => <button type="button" data-source={source} onClick={() => onSave?.("<mxGraphModel><root/></mxGraphModel>")}>mock draw.io</button>,
}));

describe("MarkdownPreview draw.io fences", () => {
  afterEach(cleanup);

  it("passes the selected fence occurrence to the safe body-change callback", () => {
    const onCodeFenceBodyChange = vi.fn(() => true);
    render(<MarkdownPreview
      content={"```drawio\nflowchart LR\nA-->B\n```\n\n```drawio\ncompressed\n```"}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
      onCodeFenceBodyChange={onCodeFenceBodyChange}
    />);
    const buttons = screen.getAllByRole("button", { name: "mock draw.io" });
    expect(buttons[0].dataset.source).toContain("flowchart LR");
    fireEvent.click(buttons[1]);
    expect(onCodeFenceBodyChange).toHaveBeenCalledWith(expect.objectContaining({ language: "drawio", body: "compressed" }), "<mxGraphModel><root/></mxGraphModel>");
  });
});
