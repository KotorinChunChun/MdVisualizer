// @ts-nocheck -- Vitest reads source CSS without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");

describe("document paper-width layouts", () => {
  it("defines auto, A4 portrait, and A3 portrait without legacy layout classes", () => {
    expect(appCss).toContain(".view-auto .markdown-body { width: 100%; max-width: none; }");
    expect(appCss).toContain(".view-a4-portrait .markdown-body { width: 210mm; }");
    expect(appCss).toContain(".view-a3-portrait .markdown-body { width: 297mm; }");
    expect(appCss).not.toContain(".view-wide");
    expect(appCss).not.toContain(".view-compact");
    expect(appCss).not.toContain(".view-print");
  });

  it("allows fixed paper widths to overflow horizontally instead of shrinking", () => {
    expect(appCss).toMatch(/\.preview-container\s*\{[\s\S]*?overflow: auto;/);
    expect(appCss).toContain("max-width: none; margin-inline: auto");
  });
});
