import { describe, expect, it } from "vitest";
import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";

describe("mergeMermaidFrontmatter", () => {
  it("adds only the application-managed theme while preserving the diagram body", () => {
    const source = "flowchart LR\nA --> B";
    const result = mergeMermaidFrontmatter(source, "neutral");

    expect(result).toBe("---\nconfig:\n  theme: neutral\n---\nflowchart LR\nA --> B");
    expect(source).toBe("flowchart LR\nA --> B");
  });

  it("drops all user frontmatter instead of selectively filtering configuration", () => {
    const result = mergeMermaidFrontmatter(
      "---\ntitle: <script>alert(1)</script>\nconfig:\n  securityLevel: loose\n  startOnLoad: true\n  secure: []\n  dompurifyConfig:\n    ADD_TAGS: [script]\n  htmlLabels: true\n  looseSecurityLevel: true\n  theme: dark\n---\nflowchart LR\nA --> B",
      "dark",
    );

    expect(result).toContain("theme: dark");
    expect(result).toContain("flowchart LR\nA --> B");
    for (const unsafeValue of ["title:", "securityLevel", "startOnLoad", "secure:", "dompurifyConfig", "htmlLabels", "looseSecurity", "<script>"]) {
      expect(result).not.toContain(unsafeValue);
    }
  });

  it("removes complete Mermaid directives, including realistic multi-line init payloads", () => {
    const result = mergeMermaidFrontmatter(
      "%%{init: {\n  'securityLevel': 'loose',\n  'flowchart': { 'htmlLabels': true },\n  'dompurifyConfig': { 'ADD_ATTR': ['onerror'], 'ALLOWED_URI_REGEXP': 'javascript:' }\n}}%%\nflowchart LR\nA --> B",
      "base",
    );

    expect(result).toContain("theme: base");
    expect(result).toContain("flowchart LR\nA --> B");
    for (const unsafeValue of ["%%{", "securityLevel", "htmlLabels", "dompurifyConfig", "onerror", "javascript:"]) {
      expect(result).not.toContain(unsafeValue);
    }
  });

  it("falls back to the safe default for an unknown application theme", () => {
    expect(mergeMermaidFrontmatter("graph TD\nA-->B", "user-controlled")).toContain("theme: default");
  });
});
