import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownLoadResult } from "../types/app";

vi.mock("./ImageRenderer", () => ({
  ImageRenderer: ({ src, alt }: { src: string; alt: string }) => <div data-testid="svg-preview" data-src={src}>{alt}</div>,
}));

vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source, mode, diagramCount }: { source: string; mode: string; diagramCount: number }) => (
    <div data-testid="mermaid-preview" data-mode={mode} data-count={diagramCount}>{source}</div>
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
  });
});
