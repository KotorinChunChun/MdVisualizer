import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source, headingTitle, storage, editable, onStorageConvert }: { source: string; headingTitle?: string; storage?: string; editable?: boolean; onStorageConvert?: () => void }) => <div>
    <output data-testid="embedded-mermaid" data-source={source} data-title={headingTitle} data-storage={storage} data-editable={String(editable)} />
    {onStorageConvert && <button type="button" onClick={onStorageConvert}>embedded storage</button>}
  </div>,
}));
vi.mock("./ExternalMermaidBlock", () => ({
  ExternalMermaidBlock: ({ source, alt, stagedSource, onStorageConvert }: { source: string; alt?: string; stagedSource?: string; onStorageConvert?: (source: string) => void }) => <div>
    <output data-testid="external-mermaid" data-source={source} data-alt={alt} data-staged={stagedSource} />
    {onStorageConvert && <button type="button" onClick={() => onStorageConvert("flowchart LR\nX --> Y")}>external storage</button>}
  </div>,
}));

import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview Mermaid storage", () => {
  afterEach(cleanup);

  it("provides one-click conversion contexts for embedded and external Mermaid", () => {
    const onMermaidStorageConvert = vi.fn();
    render(<MarkdownPreview
      content={"```mermaid title=flow\nflowchart LR\nA --> B\n```\n\n![外部](flow.mmd)"}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
      stagedMermaidSources={{ "flow.mmd": "flowchart LR\nS --> T" }}
      onMermaidStorageConvert={onMermaidStorageConvert}
      readOnly
      allowBlockActions
    />);

    expect(screen.getByTestId("embedded-mermaid").dataset.storage).toBe("embedded");
    expect(screen.getByTestId("embedded-mermaid").dataset.title).toBe("flow");
    fireEvent.click(screen.getByRole("button", { name: "embedded storage" }));
    expect(onMermaidStorageConvert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      storage: "embedded",
      source: "flowchart LR\nA --> B",
      occurrence: expect.objectContaining({ kind: "code-fence", language: "mermaid" }),
    }));
    expect(screen.getByTestId("external-mermaid").dataset.staged).toContain("S --> T");
    fireEvent.click(screen.getByRole("button", { name: "external storage" }));
    expect(onMermaidStorageConvert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      storage: "external",
      source: "flowchart LR\nX --> Y",
      occurrence: expect.objectContaining({ kind: "image", source: "flow.mmd" }),
    }));
  });

  it("routes standard and Obsidian Mermaid image embeds to the external renderer", () => {
    render(<MarkdownPreview content={"![標準](flow.mmd)\n\n![[other.mermaid|別図]]"} baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} />);
    expect(screen.getAllByTestId("external-mermaid").map((element) => [element.dataset.source, element.dataset.alt])).toEqual([
      ["flow.mmd", "標準"],
      ["other.mermaid", "別図"],
    ]);
  });
});
