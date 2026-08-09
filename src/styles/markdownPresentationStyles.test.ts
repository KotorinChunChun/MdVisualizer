// @ts-nocheck -- Vitest reads the source CSS while the application ships without Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
const presentationCss = readFileSync(join(process.cwd(), "src/styles/presentation.css"), "utf8");

function ruleBody(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("Markdown and presentation print styles", () => {
  it("styles quotes, horizontal rules, and heading borders with theme variables", () => {
    expect(ruleBody(appCss, ".markdown-body blockquote")).toContain("var(--border-color)");
    expect(ruleBody(appCss, ".markdown-body blockquote > blockquote")).toContain("border-inline-start-color");
    expect(ruleBody(appCss, ".markdown-body hr")).toContain("height: 3px");
    expect(ruleBody(appCss, ".markdown-body h1,\n.markdown-body h2,\n.markdown-body h3,\n.markdown-body h4,\n.markdown-body h5,\n.markdown-body h6")).toContain("border-bottom: 1px solid var(--border-color)");
  });

  it("keeps print colors legible and prevents printed child headings from splitting", () => {
    expect(appCss).toContain(".markdown-body blockquote { color: var(--print-effective-heading)");
    expect(appCss).toContain(".markdown-body hr { background: var(--print-effective-border); }");
    expect(appCss).toContain(':root[data-print-monochrome="true"]');
    const printChildren = ruleBody(presentationCss, ".presentation-children--print");
    expect(printChildren).toContain("break-inside: avoid");
    expect(printChildren).toContain("page-break-inside: avoid");
    expect(presentationCss).toContain("color: var(--print-effective-heading");
    expect(presentationCss).toContain("border-color: var(--print-effective-border");
  });
});
