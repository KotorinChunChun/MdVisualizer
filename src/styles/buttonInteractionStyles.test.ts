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
    expect(appCss).toContain(".code-copy, .code-run, .code-storage, .code-wrap, .diagram-action-button, .block-copy-menu { min-height: 30px;");
  });

  it("shares the code action button shape with storage conversion", () => {
    expect(appCss).toContain(".code-copy, .code-run, .code-storage, .code-wrap, .diagram-action-button, .block-copy-menu { min-height: 30px; padding: 4px 9px;");
  });

  it("keeps Mermaid view actions as separate shared-style buttons", () => {
    expect(appCss).toContain(".mermaid-toolbar__view { display: flex; order: 2; gap: 6px; }");
    expect(appCss).not.toContain(".mermaid-toolbar__view button { border-radius: 0; }");
  });

  it("gives ordinary code blocks a diagram-like title bar and body", () => {
    expect(appCss).toContain(".code-block { min-width: 0; max-width: 100%;");
    expect(appCss).toContain(".code-block__header { display: flex; min-width: 0; align-items: center;");
    expect(appCss).toContain(".code-block > pre { margin: 0; padding: 16px;");
  });

  it("renders diagram alt text as a framed row", () => {
    expect(appCss).toContain(".diagram-alt { padding: 8px 10px; color: var(--text-primary); text-align: center;");
    expect(appCss).toContain("border-top: 1px solid var(--border-color);");
  });

  it("renders responsive overflow actions as a foreground vertical menu", () => {
    expect(appCss).toContain(".responsive-toolbar__menu { position: fixed; z-index: 12020;");
    expect(appCss).toContain("flex-direction: column;");
    expect(appCss).toContain(".responsive-toolbar__menu button { width: 100%;");
    expect(appCss).toContain("white-space: nowrap;");
  });

  it("gives Codex and compact diagram menu items a stable action shape", () => {
    expect(appCss).toContain(".responsive-toolbar__menu button { width: 100%; min-width: max-content; min-height: 30px; margin: 0; padding: 7px 10px; border: 0; border-radius: 6px;");
    expect(appCss).toContain(".responsive-toolbar__menu button:not(:disabled):hover { background-image: none; background-color: var(--btn-hover);");
  });

  it("keeps diagram edit and display controls at the shared toolbar height", () => {
    expect(appCss).toContain(".diagram-edit-button { flex: 0 0 auto; width: auto; height: 30px; min-height: 30px; padding: 4px 9px; font-size: inherit; line-height: 20px;");
    expect(appCss).toContain(".responsive-toolbar select { min-height: 30px; padding: 3px 6px;");
  });
});
