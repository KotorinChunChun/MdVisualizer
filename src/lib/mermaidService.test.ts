import { describe, expect, it } from "vitest";
import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";
import { mermaidThemeFor } from "./mermaidService";

describe("mermaid render input", () => {
  it("injects a render-only theme while preserving diagram text", () => {
    const source = mergeMermaidFrontmatter("flowchart LR\nA --> B", "dark");
    expect(source).toContain("theme: dark");
    expect(source).toContain("A --> B");
  });

  it("maps every app theme to a Mermaid-supported theme", () => {
    expect(["system", "dark", "light", "github", "solarized", "nord"].map(mermaidThemeFor)).toEqual(["default", "dark", "default", "default", "base", "neutral"]);
  });
});
