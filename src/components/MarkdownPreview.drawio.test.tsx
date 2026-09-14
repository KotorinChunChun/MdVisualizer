import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("./DrawioBlock", () => ({
  DrawioBlock: ({ source, headingTitle, onSave, onMediaOpen, onStorageConvert }: { source: string; headingTitle?: string; onSave?: (source: string) => void; onMediaOpen?: (target: unknown) => void; onStorageConvert?: () => void }) => <div>
    <button type="button" data-source={source} data-title={headingTitle} data-media-open={String(Boolean(onMediaOpen))} onClick={() => onSave?.("<mxGraphModel><root/></mxGraphModel>")}>mock draw.io</button>
    {onStorageConvert && <button type="button" onClick={onStorageConvert}>fence storage</button>}
  </div>,
}));

vi.mock("./ExternalDrawioBlock", () => ({
  ExternalDrawioBlock: ({ source, alt, editable, stagedSource, onStorageConvert }: { source: string; alt?: string; editable?: boolean; stagedSource?: string; onStorageConvert?: (source: string) => void }) => <div>
    <div data-testid="external-drawio" data-source={source} data-alt={alt} data-editable={String(editable)} data-staged-source={stagedSource} />
    {onStorageConvert && <button type="button" onClick={() => onStorageConvert("<mxfile/>")}>external storage</button>}
  </div>,
}));

describe("MarkdownPreview draw.io fences", () => {
  afterEach(cleanup);

  it("keeps external SVG block actions in preview-only while preserving genuine read-only", () => {
    const props = { content: "![図](diagram.svg)", baseDir: "C:/docs", documentPath: "C:/docs/note.md", imageVersions: {}, readOnly: true };
    const { rerender } = render(<MarkdownPreview {...props} allowBlockActions />);
    expect(screen.getByTestId("external-drawio").dataset.editable).toBe("true");
    rerender(<MarkdownPreview {...props} />);
    expect(screen.getByTestId("external-drawio").dataset.editable).toBe("false");
  });

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

  it("shows the fenced draw.io title beside the block kind", () => {
    render(<MarkdownPreview
      content={'```drawio title="システム構成"\n<mxGraphModel/>\n```'}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
    />);
    expect(screen.getByRole("button", { name: "mock draw.io" }).dataset.title).toBe("システム構成");
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

  it("provides storage conversion contexts for embedded and external draw.io blocks", () => {
    const onDrawioStorageConvert = vi.fn();
    render(<MarkdownPreview
      content={"```drawio\n<mxGraphModel/>\n```\n\n![構成図](diagram.drawio)"}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
      stagedDrawioSources={{ "diagram.drawio": "<mxfile><diagram name=\"staged\"/></mxfile>" }}
      onDrawioStorageConvert={onDrawioStorageConvert}
    />);

    fireEvent.click(screen.getByRole("button", { name: "fence storage" }));
    expect(onDrawioStorageConvert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      storage: "embedded",
      source: "<mxGraphModel/>",
      occurrence: expect.objectContaining({ kind: "code-fence", language: "drawio" }),
    }));
    expect(screen.getByTestId("external-drawio").dataset.stagedSource).toContain("staged");
    fireEvent.click(screen.getByRole("button", { name: "external storage" }));
    expect(onDrawioStorageConvert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      storage: "external",
      source: "<mxfile/>",
      occurrence: expect.objectContaining({ kind: "image", source: "diagram.drawio" }),
    }));
  });
});
