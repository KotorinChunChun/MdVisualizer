import { afterEach, describe, expect, it, vi } from "vitest";
import { copyMermaid, normalizeSvgForClipboard, svgToPngBlob } from "./mermaidClipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyMermaid", () => {
  it("copies Mermaid source as text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await copyMermaid("code", "flowchart LR", "<svg />");
    expect(writeText).toHaveBeenCalledWith("flowchart LR");
  });

  it("falls back to SVG source text when vector clipboard MIME is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.stubGlobal("ClipboardItem", undefined);

    await copyMermaid("svg", "flowchart LR", "<svg><path /></svg>");
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("<path"));
  });

  it("converts Mermaid HTML labels to portable SVG text", () => {
    const result = normalizeSvgForClipboard(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <foreignObject x="10" y="20" width="180" height="40">
          <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:14px;color:#123456">Node label</div>
        </foreignObject>
      </svg>
    `);

    expect(result).not.toContain("foreignObject");
    expect(result).toContain("Node label");
    expect(result).toContain("<text");
    expect(result).toContain('viewBox="0 0 200 100"');
    expect(result).toContain('width="200"');
    expect(result).toContain('height="100"');
    expect(result).toContain('fill="#123456"');
    expect(result).toContain('data-canvas-background="true"');
    expect(result).toContain('fill="#ffffff"');
  });

  it("puts a white SVG background behind line labels and keeps multiline text above it", () => {
    const result = normalizeSvgForClipboard(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" style="max-width:200px">
        <path d="M0 50H200" />
        <g class="edgeLabel" transform="translate(100 50)">
          <foreignObject x="-40" y="-20" width="80" height="40">
            <div xmlns="http://www.w3.org/1999/xhtml">Line<br/>label</div>
          </foreignObject>
        </g>
      </svg>
    `);

    expect(result).not.toContain("foreignObject");
    expect(result).not.toContain("max-width");
    expect(result).toContain('class="clipboard-label-background"');
    expect(result).toContain('x="-40"');
    expect(result).toContain('width="80"');
    expect(result).toContain("<tspan");
    expect(result.indexOf('class="clipboard-label-background"')).toBeLessThan(result.indexOf("<text"));
  });

  it("keeps draw.io HTML labels at their styled coordinates with a visible leaf font size", () => {
    const result = normalizeSvgForClipboard(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="79.5 119.5 442 72">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;width:158px;height:1px;padding-top:155px;margin-left:81px">
            <div style="font-size:0;color:#000000"><div style="font-size:12px;font-family:Helvetica">Markdown</div></div>
          </div>
        </foreignObject>
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;width:1px;height:1px;padding-top:155px;margin-left:300px">
            <div style="font-size:0;background-color:#ffffff"><div style="font-size:11px;font-family:Helvetica">外部ファイル参照</div></div>
          </div>
        </foreignObject>
      </svg>
    `);

    expect(result).not.toContain("foreignObject");
    expect(result).toContain("Markdown");
    expect(result).toContain('x="160"');
    expect(result).toContain('y="155.5"');
    expect(result).toContain('font-size="12px"');
    expect(result).not.toContain('font-size="0"');
    expect(result).toContain('class="clipboard-label-background"');
    expect(result).toContain("外部ファイル参照");
    expect(result).toContain('viewBox="79.5 119.5 442 72"');
  });

  it("removes executable SVG content while preserving generated styles", () => {
    const result = normalizeSvgForClipboard(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <style>.node { fill: red } @import url(https://example.com/a.css);</style>
        <script>alert(1)</script>
        <rect class="node" onclick="alert(1)" width="10" height="10" />
      </svg>
    `);

    expect(result).not.toContain("<script");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("@import");
    expect(result).toContain(".node { fill: red }");
  });

  it("rasterizes the normalized SVG through a data URL", async () => {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, fillRect } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    let assignedSource = "";
    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        assignedSource = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", LoadedImage);

    const blob = await svgToPngBlob(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60">
        <foreignObject x="0" y="0" width="120" height="60"><div xmlns="http://www.w3.org/1999/xhtml">Label</div></foreignObject>
      </svg>
    `);

    expect(blob.type).toBe("image/png");
    expect(assignedSource).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(assignedSource)).toContain("<text");
    expect(fillRect).toHaveBeenCalledWith(0, 0, 120, 60);
    expect(drawImage).toHaveBeenCalled();
  });
});
