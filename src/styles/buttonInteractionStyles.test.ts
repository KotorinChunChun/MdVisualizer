// @ts-nocheck -- Vitest reads source CSS without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");

describe("button interaction styles", () => {
  it("makes every enabled app button visibly interactive", () => {
    expect(appCss).toContain("button:not(:disabled):hover");
    expect(appCss).toContain("background-image: linear-gradient");
    expect(appCss).toContain("button:focus-visible");
    expect(appCss).toContain("outline: 2px solid var(--accent-color)");
    expect(appCss).toContain("button:disabled { cursor: not-allowed; }");
  });

  it("shares one action-button shape between Mermaid and draw.io", () => {
    expect(appCss).toContain(".diagram-action-button { min-height: 30px;");
  });

  it("renders responsive overflow actions as a foreground vertical menu", () => {
    expect(appCss).toContain(".responsive-toolbar__menu { position: fixed; z-index: 12020;");
    expect(appCss).toContain("flex-direction: column;");
    expect(appCss).toContain(".responsive-toolbar__menu button { width: 100%;");
    expect(appCss).toContain("white-space: nowrap;");
  });
});
