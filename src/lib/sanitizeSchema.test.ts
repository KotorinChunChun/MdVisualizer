import { describe, expect, it } from "vitest";
import { markdownSanitizeSchema } from "./sanitizeSchema";

describe("markdownSanitizeSchema", () => {
  it("allows only explicit link protocols", () => {
    expect(markdownSanitizeSchema.protocols.href).toEqual(["http", "https", "mailto", "spmd"]);
    expect(markdownSanitizeSchema.attributes["*"]).not.toContain("onClick");
    expect(markdownSanitizeSchema.attributes["*"]).not.toContain("style");
  });

  it("limits class names to renderer-required patterns", () => {
    const classRule = markdownSanitizeSchema.attributes["*"]
      .find((attribute): attribute is [string, RegExp] => Array.isArray(attribute) && attribute[0] === "className");
    expect(classRule?.[1].test("language-mermaid")).toBe(true);
    expect(classRule?.[1].test("hljs-keyword")).toBe(true);
    expect(classRule?.[1].test("fold-section")).toBe(true);
    expect(classRule?.[1].test("arbitrary-user-class")).toBe(false);
  });

  it("keeps only the renderer marker required for Obsidian image embeds", () => {
    expect(markdownSanitizeSchema.attributes.img).toContain("data-obsidian-image");
  });
});
