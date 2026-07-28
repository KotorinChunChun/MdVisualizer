import { describe, expect, it } from "vitest";
import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";

describe("mermaid render input", () => {
  it("injects a render-only theme while preserving diagram text", () => {
    const source = mergeMermaidFrontmatter("flowchart LR\nA --> B", "dark");
    expect(source).toContain("theme: dark");
    expect(source).toContain("A --> B");
  });
});
