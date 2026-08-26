// @ts-nocheck -- Vitest reads source CSS without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/syntax-highlight.css"), "utf8");
const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");

describe("syntax highlight palettes", () => {
  it.each(["adaptive", "github-light", "github-dark", "monokai", "solarized"])("defines the %s preset", (theme) => {
    expect(css).toContain(`[data-syntax-theme="${theme}"]`);
  });

  it("styles highlight.js tokens without overriding nested search marks", () => {
    expect(css).toContain(".code-block .hljs-keyword");
    expect(css).toContain(".code-block .hljs-string");
    expect(css).not.toContain("data-markdown-search");
    expect(css).not.toContain("dangerouslySetInnerHTML");
  });

  it("removes only the outer pre frame around rich code renderers", () => {
    expect(appCss).toContain("pre:has(> .code-block)");
    expect(appCss).toContain("pre:has(> .drawio-block)");
    expect(appCss).toContain("background: transparent");
    expect(appCss).toContain("border: 0");
  });
});
