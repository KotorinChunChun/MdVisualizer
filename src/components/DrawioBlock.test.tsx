import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawioBlock, drawioViewerConfig, fitDrawioSvgToContent } from "./DrawioBlock";

vi.mock("./MermaidBlock", () => ({ MermaidBlock: ({ source, onRenderedSvg }: { source: string; onRenderedSvg?: (svg: string) => void }) => <div data-testid="mermaid-drawio" onClick={() => onRenderedSvg?.('<svg viewBox="0 0 10 10"/>')}>{source}</div> }));

describe("DrawioBlock", () => {
  afterEach(cleanup);

  it("previews SVG safely and opens the editor with conversion warnings", () => {
    const onSave = vi.fn();
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/><path d="M0 0L1 1"/><script>alert(1)</script></svg>';
    const { container } = render(<DrawioBlock source={source} theme="light" blockId="one" onSave={onSave} />);
    expect(container.innerHTML).not.toContain("script");
    expect(screen.getByText("SVG → draw.io")).toBeTruthy();
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

  it("opens a draw.io SVG in the shared popup preview when the diagram is clicked", () => {
    const onMediaOpen = vi.fn();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    render(<DrawioBlock source={source} theme="light" blockId="popup" onMediaOpen={onMediaOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "図を拡大" }));
    expect(onMediaOpen).toHaveBeenCalledWith({
      content: { kind: "svg", svg: expect.stringContaining("<rect"), alt: "draw.io図" },
    });
  });
});
