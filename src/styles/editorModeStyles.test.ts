// @ts-nocheck -- Vitest reads source files without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const headerSource = readFileSync(join(process.cwd(), "src/components/HeaderBar.tsx"), "utf8");
const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");

describe("editor mode segmented control", () => {
  it("groups the three editor modes for assistive technology", () => {
    expect(appSource).toContain('className="editor-mode-segments" role="group"');
    expect(appSource).toContain("編集のみ");
    expect(appSource).toContain("編集／閲覧");
    expect(appSource).toContain("閲覧のみ");
  });

  it("defines connected, selected, hover, focus, and disabled states", () => {
    expect(appCss).toContain(".editor-mode-segments { display: inline-flex;");
    expect(appCss).toContain(".editor-mode-segments button:first-child");
    expect(appCss).toContain(".editor-mode-segments button:last-child");
    expect(appCss).toContain(".editor-mode-segments button:hover:not(:disabled):not(.is-active)");
    expect(appCss).toContain(".editor-mode-segments button:focus-visible");
    expect(appCss).toContain(".editor-mode-segments button.is-active");
    expect(appCss).toContain(".editor-mode-segments button:disabled");
  });

  it("uses the requested reload label in both headers", () => {
    expect(appSource).toContain(">再読込</button>");
    expect(appSource).not.toContain(">再読み込み</button>");
    expect(headerSource).toContain("再読込");
    expect(headerSource).not.toContain("再読み込み");
  });
});
