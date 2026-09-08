import { describe, expect, it, vi } from "vitest";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaidMock }));

import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";
import {
  MERMAID_LIMITS,
  mermaidInputError,
  mermaidRenderId,
  mermaidThemeFor,
  renderMermaid,
  resetMermaidServiceForTests,
} from "./mermaidService";

describe("Mermaid renderer security boundary", () => {
  it("initializes Mermaid strictly and never forwards directive/frontmatter relaxation", async () => {
    resetMermaidServiceForTests();
    mermaidMock.initialize.mockReset();
    mermaidMock.render.mockReset().mockResolvedValue({ svg: "<svg><text>safe</text></svg>" });
    const payload = "---\nconfig:\n  securityLevel: loose\n  dompurifyConfig:\n    ADD_TAGS: [script]\n---\n%%{init: { 'startOnLoad': true, 'flowchart': { 'htmlLabels': true }, 'dompurifyConfig': { 'ADD_ATTR': ['onerror'] } }}%%\nflowchart LR\nA --> B";

    await expect(renderMermaid(payload, "safe-id", "dark")).resolves.toBe("<svg><text>safe</text></svg>");

    expect(mermaidMock.initialize).toHaveBeenCalledWith({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
    const renderedInput = mermaidMock.render.mock.calls[0]?.[1] as string;
    expect(renderedInput).toContain("theme: dark");
    for (const unsafeValue of ["securityLevel", "startOnLoad", "dompurifyConfig", "htmlLabels", "onerror", "script", "%%{"]) {
      expect(renderedInput).not.toContain(unsafeValue);
    }
  });
});

describe("mermaid render input", () => {
  it("injects a render-only theme while preserving diagram text", () => {
    const source = mergeMermaidFrontmatter("flowchart LR\nA --> B", "dark");
    expect(source).toContain("theme: dark");
    expect(source).toContain("A --> B");
  });

  it("maps every app theme to a Mermaid-supported theme", () => {
    expect(["system", "dark", "light", "github", "solarized", "nord"].map(mermaidThemeFor)).toEqual(["default", "dark", "default", "default", "base", "neutral"]);
  });

  it("creates unique IDs for window/tab/block/generation", () => {
    expect(mermaidRenderId({ windowId: "win:1", tabId: "tab/2", blockId: "block 3", generation: 4 }))
      .toBe("win-1-tab-2-block-3-g4");
  });

  it("rejects document and input sizes over safe limits", () => {
    expect(mermaidInputError("A --> B", { diagramCount: MERMAID_LIMITS.diagramsPerDocument + 1 })).toContain("too many");
    expect(mermaidInputError("x".repeat(MERMAID_LIMITS.sourceLength + 1))).toContain("too large");
    expect(mermaidInputError("A --> B\n".repeat(MERMAID_LIMITS.edgeCount + 1))).toContain("connections");
  });
});
