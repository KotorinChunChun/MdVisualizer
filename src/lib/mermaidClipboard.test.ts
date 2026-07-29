import { afterEach, describe, expect, it, vi } from "vitest";
import { copyMermaid } from "./mermaidClipboard";

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
    expect(writeText).toHaveBeenCalledWith("<svg><path /></svg>");
  });
});
