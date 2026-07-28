import { describe, expect, it } from "vitest";
import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";

describe("mergeMermaidFrontmatter", () => {
  it("preserves user content while preventing security overrides", () => {
    const result = mergeMermaidFrontmatter(
      "---\nconfig:\n  securityLevel: loose\n  theme: dark\n---\nflowchart LR\n A-->B",
      "neutral",
    );
    expect(result).toContain("theme: neutral");
    expect(result).not.toContain("securityLevel");
    expect(result).toContain("flowchart LR");
  });
});
