import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("./DrawioBlock", () => ({
  DrawioBlock: ({ source, onSave, onMediaOpen }: { source: string; onSave?: (source: string) => void; onMediaOpen?: (target: unknown) => void }) => <button type="button" data-source={source} data-media-open={String(Boolean(onMediaOpen))} onClick={() => onSave?.("<mxGraphModel><root/></mxGraphModel>")}>mock draw.io</button>,
}));

vi.mock("./ExternalDrawioBlock", () => ({
  ExternalDrawioBlock: ({ source, alt, editable }: { source: string; alt?: string; editable?: boolean }) => (
    <div data-testid="external-drawio" data-source={source} data-alt={alt} data-editable={String(editable)} />
  ),
}));

describe("MarkdownPreview draw.io fences", () => {
  afterEach(cleanup);

  it("passes the selected fence occurrence to the safe body-change callback", () => {
    const onCodeFenceBodyChange = vi.fn(() => true);
    const onMediaOpen = vi.fn();
    render(<MarkdownPreview
      content={"```drawio\nflowchart LR\nA-->B\n```\n\n```drawio\ncompressed\n```"}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
      onCodeFenceBodyChange={onCodeFenceBodyChange}
      onMediaOpen={onMediaOpen}
    />);
    const buttons = screen.getAllByRole("button", { name: "mock draw.io" });
    expect(buttons[0].dataset.source).toContain("flowchart LR");
    expect(buttons[0].dataset.mediaOpen).toBe("true");
    fireEvent.click(buttons[1]);
    expect(onCodeFenceBodyChange).toHaveBeenCalledWith(expect.objectContaining({ language: "drawio", body: "compressed" }), "<mxGraphModel><root/></mxGraphModel>");
  });

  it("routes standard and Obsidian draw.io image embeds to the external draw.io preview", () => {
    render(<MarkdownPreview
      content={"![標準](diagrams/standard.drawio)\n\n![[diagrams/obsidian.drawio|Obsidian]]"}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{ "C:/docs/diagrams/standard.drawio": 2 }}
    />);

    expect(screen.getAllByTestId("external-drawio").map((element) => ({
      source: element.dataset.source,
      alt: element.dataset.alt,
      editable: element.dataset.editable,
    }))).toEqual([
      { source: "diagrams/standard.drawio", alt: "標準", editable: "true" },
      { source: "diagrams/obsidian.drawio", alt: "Obsidian", editable: "true" },
    ]);
  });
});
