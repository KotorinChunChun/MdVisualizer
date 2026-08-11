import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import gallery from "../../samples/mermaid-gallery.md?raw";

describe("Mermaid gallery", () => {
  it("contains only Mermaid fences accepted by the current renderer", async () => {
    const diagrams = [...gallery.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)]
      .map((match) => match[1].trim());

    expect(diagrams).toHaveLength(7);
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    for (const source of diagrams) {
      await expect(mermaid.parse(source, { suppressErrors: false })).resolves.toBeTruthy();
    }
  });
});
