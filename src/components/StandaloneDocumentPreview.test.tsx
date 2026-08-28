import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownLoadResult } from "../types/app";

vi.mock("./ImageRenderer", () => ({
  ImageRenderer: ({ src, alt }: { src: string; alt: string }) => <div data-testid="svg-preview" data-src={src}>{alt}</div>,
}));

vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source, mode, diagramCount, headingTitle }: { source: string; mode: string; diagramCount: number; headingTitle?: string }) => (
    <div data-testid="mermaid-preview" data-mode={mode} data-count={diagramCount} data-title={headingTitle}>{source}</div>
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
  afterEach(cleanup);

  it("routes an SVG file through the existing image renderer", () => {
    render(<StandaloneDocumentPreview
      document={document("svg", "C:\\docs\\diagram.svg", "<svg />")}
      imageVersions={{}}
      theme="dark"
      windowId="main"
      tabId="tab-1"
    />);

    expect(screen.getByTestId("svg-preview").getAttribute("data-src")).toBe("C:\\docs\\diagram.svg");
    expect(screen.getByTestId("svg-preview").textContent).toContain("diagram.svg");
  });

  it("routes Mermaid source through the existing Mermaid renderer", () => {
    render(<StandaloneDocumentPreview
      document={document("mermaid", "C:\\docs\\flow.mmd", "flowchart LR\nA --> B")}
      imageVersions={{}}
      theme="nord"
      windowId="main"
      tabId="tab-2"
    />);

    expect(screen.getByTestId("mermaid-preview").textContent).toContain("A --> B");
    expect(screen.getByTestId("mermaid-preview").getAttribute("data-mode")).toBe("on");
    expect(screen.getByTestId("mermaid-preview").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("mermaid-preview").dataset.title).toBe("flow.mmd");
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
