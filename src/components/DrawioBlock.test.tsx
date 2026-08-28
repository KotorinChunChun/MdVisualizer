import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawioBlock, drawioPreviewHeight, drawioViewerConfig, drawioViewerDocument, fitDrawioSvgToContent, isEmptyDrawioSource } from "./DrawioBlock";

vi.mock("./MermaidBlock", () => ({ MermaidBlock: ({ source, onRenderedSvg }: { source: string; onRenderedSvg?: (svg: string) => void }) => <div data-testid="mermaid-drawio" onClick={() => onRenderedSvg?.('<svg viewBox="0 0 10 10"/>')}>{source}</div> }));

describe("DrawioBlock", () => {
  afterEach(cleanup);

  it("previews SVG safely and opens the editor with conversion warnings", () => {
    const onSave = vi.fn();
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/><path d="M0 0L1 1"/><script>alert(1)</script></svg>';
    const { container } = render(<DrawioBlock source={source} theme="light" blockId="one" headingTitle="構成図" onSave={onSave} />);
    expect(container.innerHTML).not.toContain("script");
    expect(screen.getByText("SVG → draw.io — 構成図")).toBeTruthy();
    const editButton = screen.getByRole("button", { name: "編集" });
    expect(editButton.classList.contains("diagram-action-button")).toBe(true);
    fireEvent.click(editButton);
    expect(screen.getByRole("dialog", { name: "draw.io図の編集" })).toBeTruthy();
    expect(screen.getByText(/<path>/)).toBeTruthy();
  });

  it("uses the Mermaid preview for draw.io Mermaid sources", () => {
    render(<DrawioBlock source={"flowchart LR\nA-->B"} theme="dark" blockId="two" />);
    expect(screen.getByTestId("mermaid-drawio").textContent).toContain("A-->B");
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
  });

  it("uses responsive viewer bounds without the built-in zoom toolbar", () => {
    const config = drawioViewerConfig("<mxGraphModel/>");
    expect(config.responsive).toBe(true);
    expect(config.border).toBe(0);
    expect(config).not.toHaveProperty("toolbar");
  });

  it("isolates the draw.io viewer in its own document and escapes XML from HTML attributes", () => {
    const document = drawioViewerDocument('<mxGraphModel><root value="&quot; onload=&quot;alert(1)"/></mxGraphModel>');
    expect(document).toContain("viewer-static.min.js");
    expect(document).toContain("class=\"mxgraph\"");
    expect(document).not.toContain('data-mxgraph="{"');
    expect(document).toContain("&amp;quot;");
    expect(document).toContain("height:100%");
    expect(document).toContain("min-height:0");
  });

  it("calculates preview height from the rendered viewBox and current width", () => {
    const wide = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 100"/>';
    const tall = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 200 400"/>';
    expect(drawioPreviewHeight(wide, 1000)).toBe(200);
    expect(drawioPreviewHeight(wide, 250)).toBe(50);
    expect(drawioPreviewHeight(tall, 300)).toBe(600);
    expect(drawioPreviewHeight('<svg xmlns="http://www.w3.org/2000/svg"/>', 300)).toBeNull();
    expect(drawioPreviewHeight(wide, 0)).toBeNull();
  });

  it("crops a rendered diagram to its actual bounds and keeps negative coordinates", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "1000");
    svg.setAttribute("height", "800");
    svg.setAttribute("style", "width:1000px;height:800px;max-width:100%;background:#fff");
    Object.defineProperty(svg, "getBBox", {
      value: () => ({ x: -30, y: -10, width: 120, height: 70 }),
    });

    const result = fitDrawioSvgToContent(svg, 10);
    expect(result).toContain('viewBox="-40 -20 140 90"');
    expect(result).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(result).not.toContain('width="1000"');
    expect(result).not.toContain("width:1000px");
    expect(result).toContain("background:#fff");
    expect(svg.getAttribute("viewBox")).toBeNull();
  });

  it("keeps the viewer viewBox for an empty diagram", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 1 1");
    Object.defineProperty(svg, "getBBox", {
      value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    });

    expect(fitDrawioSvgToContent(svg)).toContain('viewBox="0 0 1 1"');
  });

  it("recognizes an empty draw.io canvas and keeps its bootstrap height near 100px", () => {
    const empty = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
    const populated = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" vertex="1" parent="1"/></root></mxGraphModel>';
    expect(isEmptyDrawioSource(empty)).toBe(true);
    expect(isEmptyDrawioSource(populated)).toBe(false);

    render(<DrawioBlock source={empty} theme="light" blockId="empty" />);
    expect((screen.getByTitle("draw.ioプレビュー") as HTMLIFrameElement).style.height).toBe("100px");
  });

  it("adds a 20px margin to the viewer-provided content viewBox", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "79.5 119.5 442 72");
    svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
    Object.defineProperty(svg, "getBBox", {
      value: () => ({ x: 0, y: 0, width: 520.5, height: 190.5 }),
    });

    const result = fitDrawioSvgToContent(svg);
    expect(result).toContain('viewBox="59.5 99.5 482 112"');
    expect(result).not.toContain('viewBox="-20 -20 560.5 230.5"');
  });

  it("offers the same copy and display controls as Mermaid", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    render(<DrawioBlock source={source} theme="light" blockId="controls" />);

    expect(screen.getByRole("toolbar", { name: "draw.io操作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "コードをコピー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ラスタコピー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ベクタコピー" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    expect(screen.getByText(source)).toBeTruthy();
  });

  it("can return from code to preview before an edited XML diagram finishes rendering", () => {
    const source = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" vertex="1" parent="1"/></root></mxGraphModel>';
    render(<DrawioBlock source={source} theme="light" blockId="preview-return" />);

    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    const preview = screen.getByRole("button", { name: "プレビュー" });
    expect((preview as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(preview);
    expect(screen.getByTitle("draw.ioプレビュー")).toBeTruthy();
  });

  it("recreates the viewer once when its external script reports a startup failure", async () => {
    const source = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" vertex="1" parent="1"/></root></mxGraphModel>';
    render(<DrawioBlock source={source} theme="light" blockId="viewer-retry" />);
    const firstFrame = screen.getByTitle("draw.ioプレビュー") as HTMLIFrameElement;

    fireEvent(window, new MessageEvent("message", {
      source: firstFrame.contentWindow,
      data: { type: "markdown-viewer-drawio-error" },
    }));

    await waitFor(() => expect(screen.getByTitle("draw.ioプレビュー")).not.toBe(firstFrame));
    expect(screen.queryByText("draw.ioビューアーを読み込めませんでした。")).toBeNull();
  });

  it("replaces the bootstrap iframe with the captured responsive SVG", async () => {
    const source = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
    render(<DrawioBlock source={source} theme="light" blockId="captured" onMediaOpen={() => {}} />);
    const iframe = screen.getByTitle("draw.ioプレビュー") as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent("message", {
      source: iframe.contentWindow,
      data: { type: "markdown-viewer-drawio-svg", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100"/></svg>' },
    }));

    await waitFor(() => expect(screen.queryByTitle("draw.ioプレビュー")).toBeNull());
    const zoom = screen.getByRole("button", { name: "図を拡大" });
    expect(zoom.querySelector("svg")?.getAttribute("viewBox")).toBe("-20 -20 440 140");
  });

  it("switches an embedded draw.io block to external storage", async () => {
    const onStorageConvert = vi.fn();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    render(<DrawioBlock source={source} theme="light" blockId="storage" storage="embedded" onStorageConvert={onStorageConvert} />);

    fireEvent.click(screen.getByRole("button", { name: "外部ファイルへ切替" }));
    await waitFor(() => expect(onStorageConvert).toHaveBeenCalledOnce());
  });

  it("opens a draw.io SVG in the shared popup preview when the diagram is clicked", () => {
    const onMediaOpen = vi.fn();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    render(<DrawioBlock source={source} theme="light" blockId="popup" onMediaOpen={onMediaOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "図を拡大" }));
    expect(onMediaOpen).toHaveBeenCalledWith({
      content: { kind: "svg", svg: expect.stringContaining("<rect"), alt: "draw.io図" },
      diagramSource: source,
      diagramKind: "drawio",
    });
  });
});
