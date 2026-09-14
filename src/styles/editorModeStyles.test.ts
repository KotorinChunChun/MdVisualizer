// @ts-nocheck -- Vitest reads source files without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const headerSource = readFileSync(join(process.cwd(), "src/components/HeaderBar.tsx"), "utf8");
const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
const viewControlsSource = readFileSync(join(process.cwd(), "src/components/WorkspaceViewControls.tsx"), "utf8");
const viewControlsCss = readFileSync(join(process.cwd(), "src/styles/workspace-view-controls.css"), "utf8");

describe("workspace view controls", () => {
  it("groups the independent code and preview controls for assistive technology", () => {
    expect(appSource).toContain("<WorkspaceViewControls");
    expect(viewControlsSource).toContain('className="workspace-view-controls" role="group" aria-label="表示切替"');
    expect(viewControlsSource).toContain(">コード</button>");
    expect(viewControlsSource).toContain("プレビュー限定");
    expect(viewControlsSource).toContain("ビジュアル編集");
    expect(viewControlsSource).toContain("<option value=\"off\"");
  });

  it("defines code, preview, visual editing, and direction states", () => {
    expect(viewControlsCss).toContain(".workspace-view-controls { display:flex;");
    expect(viewControlsCss).toContain(".workspace-preview-control.is-preview");
    expect(viewControlsCss).toContain(".workspace-preview-control.is-visual,.workspace-view-controls button.is-active");
    expect(viewControlsSource).toContain('aria-label="分割方向"');
    expect(viewControlsSource).toContain(">自動</option>");
    expect(viewControlsSource).toContain(">上下</option>");
    expect(viewControlsSource).toContain(">左右</option>");
  });

  it("uses the requested reload label in both headers", () => {
    expect(appSource).toContain(">再読込</button>");
    expect(appSource).not.toContain(">再読み込み</button>");
    expect(headerSource).toContain("再読込");
    expect(headerSource).not.toContain("再読み込み");
  });

  it("highlights the View block corresponding to the active Edit line", () => {
    expect(appCss).toContain(".markdown-body [data-source-line].is-editor-current-line");
    expect(appCss).toContain("#fde68a");
  });

  // Diffの書式・行位置はtest:diff-layoutで実ブラウザーのcomputed styleと座標を検証する。
});
