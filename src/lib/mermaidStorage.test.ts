import { describe, expect, it } from "vitest";
import type { CodeFenceOccurrence } from "./markdownOccurrences";
import { mermaidEmbeddedFence, mermaidExternalReference, preferredMermaidFilename } from "./mermaidStorage";

describe("Mermaid storage conversion", () => {
  it("creates an external image reference and a safe embedded fence", () => {
    expect(mermaidExternalReference("diagrams/flow.mmd", "処理フロー")).toBe("![処理フロー](diagrams/flow.mmd)");
    expect(mermaidExternalReference("my diagrams/flow.mmd")).toBe("![](<my diagrams/flow.mmd>)");
    expect(mermaidEmbeddedFence("flowchart LR\r\nA[`x`] --> B", "\r\n")).toBe("```mermaid\r\nflowchart LR\r\nA[`x`] --> B\r\n```");
  });

  it("uses title metadata for the recommended mmd filename", () => {
    expect(preferredMermaidFilename({ meta: 'title="処理 フロー"' } as CodeFenceOccurrence)).toBe("処理-フロー.mmd");
    expect(preferredMermaidFilename({ meta: "caption=system.mermaid" } as CodeFenceOccurrence)).toBe("system.mmd");
  });
});
