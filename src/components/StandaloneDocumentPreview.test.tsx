import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownLoadResult } from "../types/app";

vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source, mode, diagramCount, headingTitle, editable, onSourceChange }: { source: string; mode: string; diagramCount: number; headingTitle?: string; editable?: boolean; onSourceChange?: (source: string) => void }) => (
    <button type="button" data-testid="mermaid-preview" data-mode={mode} data-count={diagramCount} data-title={headingTitle} data-editable={String(editable)} onClick={() => onSourceChange?.("flowchart LR\nA --> C")}>{source}</button>
  ),
}));

vi.mock("./DrawioBlock", () => ({
  DrawioBlock: ({ source, headingTitle, onSave }: { source: string; headingTitle?: string; onSave?: (source: string) => void }) => (
    <button type="button" data-testid="drawio-preview" data-title={headingTitle} onClick={() => onSave?.("<mxfile><diagram name=\"saved\"/></mxfile>")}>{source}</button>
  ),
}));

import { StandaloneDocumentPreview } from "./StandaloneDocumentPreview";

function document(kind: MarkdownLoadResult["kind"], path: string, content: string): MarkdownLoadResult {
  return {
    path,
    kind,
    content,
    base_dir: "C:\\docs",
    image_paths: [],
    encoding: "UTF-8",
    size_bytes: content.length,
    modified_at: "2026-08-09 12:00",
    revision: "revision-1",
  };
}

describe("StandaloneDocumentPreview", () => {
  it("renders a TSV file in the dedicated table UI", () => {
    render(<StandaloneDocumentPreview
      document={{ path: "C:\\docs\\table.tsv", kind: "tsv", content: "name\tvalue\nA\t1", base_dir: "C:\\docs", image_paths: [], encoding: "UTF-8", size_bytes: 12, modified_at: "", revision: "r1", source: "local", web_url: null, etag: null }}
      imageVersions={{}}
      theme="light"
      windowId="window"
      tabId="tab"
    />);
    expect(screen.getByRole("region", { name: "TSV表" })).toBeTruthy();
    expect(screen.getByText("table.tsv")).toBeTruthy();
  });
  afterEach(cleanup);

  it("routes an SVG file through the shared SVG block and its draft callback", () => {
    const onTextChange = vi.fn();
    render(<StandaloneDocumentPreview
      document={document("svg", "C:\\docs\\diagram.svg", "<svg />")}
      imageVersions={{}}
      theme="dark"
      windowId="main"
      tabId="tab-1"
      onTextChange={onTextChange}
    />);

    screen.getByTestId("drawio-preview").click();
    expect(screen.getByTestId("drawio-preview").dataset.title).toBe("diagram.svg");
    expect(onTextChange).toHaveBeenCalledWith("<mxfile><diagram name=\"saved\"/></mxfile>");
  });

  it("routes Mermaid source through the existing renderer and its draft callback", () => {
    const onTextChange = vi.fn();
    render(<StandaloneDocumentPreview
      document={document("mermaid", "C:\\docs\\flow.mmd", "flowchart LR\nA --> B")}
      imageVersions={{}}
      theme="nord"
      windowId="main"
      tabId="tab-2"
      onTextChange={onTextChange}
    />);

    expect(screen.getByTestId("mermaid-preview").textContent).toContain("A --> B");
    expect(screen.getByTestId("mermaid-preview").getAttribute("data-mode")).toBe("on");
    expect(screen.getByTestId("mermaid-preview").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("mermaid-preview").dataset.title).toBe("flow.mmd");
    expect(screen.getByTestId("mermaid-preview").dataset.editable).toBe("true");
    screen.getByTestId("mermaid-preview").click();
    expect(onTextChange).toHaveBeenCalledWith("flowchart LR\nA --> C");
  });

  it("routes a draw.io file through the existing draw.io renderer and save callback", () => {
    const onDrawioSave = vi.fn();
    render(<StandaloneDocumentPreview
      document={document("drawio", "C:\\docs\\system.drawio", "<mxfile><diagram/></mxfile>")}
      imageVersions={{}}
      theme="dark"
      windowId="main"
      tabId="tab-3"
      onDrawioSave={onDrawioSave}
    />);

    screen.getByTestId("drawio-preview").click();
    expect(screen.getByTestId("drawio-preview").textContent).toContain("mxfile");
    expect(screen.getByTestId("drawio-preview").dataset.title).toBe("system.drawio");
    expect(onDrawioSave).toHaveBeenCalledWith("<mxfile><diagram name=\"saved\"/></mxfile>");
  });
});
