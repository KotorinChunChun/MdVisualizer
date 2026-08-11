// @ts-nocheck -- Vitest reads the source CSS while the application ships without Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
const presentationCss = readFileSync(join(process.cwd(), "src/styles/presentation.css"), "utf8");
const inlineImageCss = readFileSync(join(process.cwd(), "src/styles/inline-image-resize.css"), "utf8");

function ruleBody(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("Markdown and presentation print styles", () => {
  it("styles quotes, horizontal rules, and heading borders with theme variables", () => {
    expect(ruleBody(appCss, ".markdown-body blockquote")).toContain("var(--border-color)");
    expect(ruleBody(appCss, ".markdown-body blockquote > blockquote")).toContain("border-inline-start-color");
    expect(ruleBody(appCss, ".markdown-body blockquote > :last-child")).toContain("margin-bottom: 0");
    expect(ruleBody(appCss, ".markdown-body hr")).toContain("height: 3px");
    expect(ruleBody(appCss, ".markdown-body h1,\n.markdown-body h2,\n.markdown-body h3,\n.markdown-body h4,\n.markdown-body h5,\n.markdown-body h6")).toContain("border-bottom: 1px solid var(--border-color)");
  });

  it("keeps side-by-side images proportional and vertically centered", () => {
    const rowRule = ruleBody(appCss, ".markdown-body p:has(> .inline-image-resize ~ .inline-image-resize)");
    const stageRule = ruleBody(appCss, ".markdown-body p:has(> .inline-image-resize ~ .inline-image-resize) .inline-image-resize__stage");
    const imageRule = ruleBody(appCss, ".markdown-body p:has(> .inline-image-resize ~ .inline-image-resize) .inline-image-resize__image");
    expect(rowRule).toContain("align-items: stretch");
    expect(stageRule).toContain("align-items: center");
    expect(imageRule).toContain("height: auto !important");
    expect(imageRule).toContain("object-fit: contain");
  });

  it("caps heading images at the heading text height", () => {
    const frameRule = ruleBody(inlineImageCss, ".markdown-body .inline-image-resize.is-heading");
    const imageRule = ruleBody(inlineImageCss, ".markdown-body .inline-image-resize.is-heading .inline-image-resize__stage > img.markdown-img.inline-image-resize__image");
    expect(frameRule).toContain("max-height: 1em");
    expect(imageRule).toContain("height: 1em");
    expect(imageRule).toContain("max-height: 1em");
    const presentationImageRule = ruleBody(presentationCss, ".presentation-stage .markdown-body :is(h1, h2, h3, h4, h5, h6) .markdown-img");
    const presentationCaptionRule = ruleBody(presentationCss, ".presentation-stage .markdown-body :is(h1, h2, h3, h4, h5, h6) .inline-image-resize__caption");
    expect(presentationImageRule).toContain("max-height: 1em");
    expect(presentationCaptionRule).toContain("display: none");
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
