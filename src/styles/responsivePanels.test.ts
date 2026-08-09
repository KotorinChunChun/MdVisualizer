// @ts-nocheck -- Vitest reads source CSS without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
const panelCss = readFileSync(join(process.cwd(), "src/styles/document-side-panel.css"), "utf8");

describe("responsive document side panels", () => {
  it("uses a sidecar from 860px and a drawer below it while reserving the launcher rail", () => {
    expect(panelCss).toContain("@media (max-width: 859px)");
    expect(panelCss).toContain(".document-side-panel__backdrop");
    expect(panelCss).toContain("position: fixed");
    expect(panelCss).toContain(".document-side-panel-root { width: 3.25rem; }");
    expect(appCss).not.toContain(".search-results-panel");
    expect(appCss).not.toContain(".document-workspace.has-image-gallery");
  });
});
