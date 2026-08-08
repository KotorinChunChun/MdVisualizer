// @ts-nocheck -- Vitest reads source CSS without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
const tocCss = readFileSync(join(process.cwd(), "src/styles/document-toc.css"), "utf8");

describe("responsive document side panels", () => {
  it("uses a sidecar from 860px and a drawer below it", () => {
    expect(tocCss).toContain("@media (min-width: 860px)");
    expect(tocCss).toContain("@media (max-width: 859px)");
    expect(appCss).toContain("@media (max-width: 859px)");
    expect(appCss).toContain(".search-results-backdrop");
    expect(appCss).not.toContain("@media (max-width: 1499px) {\n  .search-results-panel");
  });
});
