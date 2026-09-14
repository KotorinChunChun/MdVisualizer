import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceViewControls, type PreviewMode, type SplitDirection } from "./WorkspaceViewControls";

function Fixture({ code = true, preview = "off" as PreviewMode, direction = "auto" as SplitDirection, disabled = false }: { code?: boolean; preview?: PreviewMode; direction?: SplitDirection; disabled?: boolean }) {
  const [state, setState] = useState({ code, preview, direction });
  return <><WorkspaceViewControls {...state} disabled={disabled} onChange={(nextCode, nextPreview) => setState((current) => ({ ...current, code: nextCode, preview: nextPreview }))} onDirectionChange={(nextDirection) => setState((current) => ({ ...current, direction: nextDirection }))} /><output data-testid="state">{JSON.stringify(state)}</output></>;
}

describe("表示切替", () => {
  afterEach(cleanup);
  it("ラベル付きのグループ、コードトグル、プレビュー三択、方向選択を公開する", () => {
    render(<Fixture />);
    expect(screen.getByRole("group", { name: "表示切替" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "コード" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("プレビュー") as HTMLSelectElement).value).toBe("off");
    expect((screen.getByLabelText("分割方向") as HTMLSelectElement).value).toBe("auto");
  });
  it("コードとプレビューを同時にOFFにせず、状態別の青色classを保つ", () => {
    render(<Fixture code={true} preview="off" />);
    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    expect(screen.getByTestId("state").textContent).toContain('"code":false');
    expect(screen.getByTestId("state").textContent).toContain('"preview":"preview"');
    expect(document.querySelector(".workspace-preview-control.is-preview")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("プレビュー"), { target: { value: "visual" } });
    expect(document.querySelector(".workspace-preview-control.is-visual")).toBeTruthy();
  });
  it("プレビューOFFを選ぶとコードを強制表示し、方向を切り替える", () => {
    render(<Fixture code={false} preview="preview" />);
    fireEvent.change(screen.getByLabelText("プレビュー"), { target: { value: "off" } });
    expect(screen.getByTestId("state").textContent).toContain('"code":true');
    fireEvent.change(screen.getByLabelText("分割方向"), { target: { value: "horizontal" } });
    expect((screen.getByLabelText("分割方向") as HTMLSelectElement).value).toBe("horizontal");
  });
  it("無効状態では操作を受け付けない", () => {
    render(<Fixture disabled />);
    expect((screen.getByRole("button", { name: "コード" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("プレビュー") as HTMLSelectElement).value).toBe("off");
  });
});
