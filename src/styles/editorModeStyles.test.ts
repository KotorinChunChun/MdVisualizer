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
  it("groups the display and interaction mode controls for assistive technology", () => {
    expect(appSource).toContain("<WorkspaceViewControls");
    expect(viewControlsSource).toContain('className="workspace-view-controls" role="group" aria-label="表示切替"');
    expect(viewControlsSource).toContain(">コード</button>");
    expect(viewControlsSource).toContain(">コード｜ビジュアル</button>");
    expect(viewControlsSource).toContain(">ビジュアル</button>");
    expect(viewControlsSource).toContain(">閲覧</button>");
    expect(viewControlsSource).toContain(">編集</button>");
    expect(viewControlsSource).toContain("workspace-view-controls__separator");
  });

  it("defines display, interaction, and direction states", () => {
    expect(viewControlsCss).toContain(".workspace-view-controls { display:flex;");
    expect(viewControlsCss).toContain(".workspace-view-controls__display,.workspace-view-controls__interaction");
    expect(viewControlsCss).toContain(".workspace-view-controls__segmented { gap:0;");
    expect(viewControlsCss).toContain(".workspace-view-controls__segmented button { border:0;");
    expect(viewControlsCss).toContain(".workspace-view-controls__separator");
    expect(viewControlsCss).toContain('[data-ui-command="view.split"][aria-pressed="true"]');
    expect(viewControlsCss).toContain('[data-ui-command="view.visual"][aria-pressed="true"]');
    expect(viewControlsCss).toContain('.workspace-view-controls [data-ui-command="document.diff"][aria-pressed="true"]');
    expect(appSource).toContain('className={`document-action-button${documentDiff !== null ? " is-active" : ""}`}');
    expect(viewControlsSource).toContain('aria-label="分割方向"');
    expect(viewControlsSource).toContain(">自動分割</option>");
    expect(viewControlsSource).toContain(">上下分割</option>");
    expect(viewControlsSource).toContain(">左右分割</option>");
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
