import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceViewControls, type InteractionMode, type PreviewMode, type SplitDirection } from "./WorkspaceViewControls";

function Fixture({ code = true, preview = "off" as PreviewMode, direction = "auto" as SplitDirection, interactionMode = "browse" as InteractionMode, disabled = false }: { code?: boolean; preview?: PreviewMode; direction?: SplitDirection; interactionMode?: InteractionMode; disabled?: boolean }) {
  const [state, setState] = useState({ code, preview, direction, interactionMode });
  return <><WorkspaceViewControls {...state} disabled={disabled} onChange={(nextCode, nextPreview) => setState((current) => ({ ...current, code: nextCode, preview: nextPreview }))} onInteractionModeChange={(nextMode) => setState((current) => ({ ...current, interactionMode: nextMode }))} onDirectionChange={(nextDirection) => setState((current) => ({ ...current, direction: nextDirection }))} /><output data-testid="state">{JSON.stringify(state)}</output></>;
}

describe("表示切替", () => {
  afterEach(cleanup);
  it.each((["code", "split", "visual"] as const).flatMap(displayMode => (["auto", "vertical", "horizontal"] as SplitDirection[]).map(direction => ({ displayMode, direction }))))
  ("有効な表示状態 $displayMode/$direction で切替後も表示を残す", ({ displayMode, direction }) => {
    const state = displayMode === "code" ? { code: true, preview: "off" as PreviewMode } : displayMode === "split" ? { code: true, preview: "preview" as PreviewMode } : { code: false, preview: "preview" as PreviewMode };
    render(<Fixture {...state} direction={direction} />);
    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    const nextState = JSON.parse(screen.getByTestId("state").textContent!);
    expect(nextState.code).toBe(true);
    expect(nextState.preview).toBe("off");
    expect((screen.getByLabelText("分割方向") as HTMLSelectElement).value).toBe(direction);
  });
  it("表示3択、閲覧編集、方向選択を公開する", () => {
    render(<Fixture />);
    expect(screen.getByRole("group", { name: "表示切替" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "コード" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "コード｜ビジュアル" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ビジュアル" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "操作モード" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "閲覧" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "編集" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByLabelText("分割方向") as HTMLSelectElement).value).toBe("auto");
  });
  it("操作モードのセパレーターとホスト固有操作を表示順に置ける", () => {
    render(<WorkspaceViewControls code preview="preview" direction="auto" interactionMode="browse" onInteractionModeChange={() => undefined} onChange={() => undefined} onDirectionChange={() => undefined} betweenPreviewAndDirection={<button type="button">差分</button>} />);
    const controls = Array.from(screen.getByRole("group", { name: "表示切替" }).children);
    expect(controls[0].querySelector('[data-ui-command="view.code"]')).toBeTruthy();
    expect(controls[0].querySelector('[data-ui-command="view.split"]')).toBeTruthy();
    expect(controls[0].querySelector('[data-ui-command="view.visual"]')).toBeTruthy();
    expect(controls[1].getAttribute("role")).toBe("separator");
    expect(controls[2].querySelector('[data-ui-command="view.browse"]')).toBeTruthy();
    expect(controls[2].querySelector('[data-ui-command="view.edit"]')).toBeTruthy();
    expect(controls[3].textContent).toBe("差分");
    expect(controls[4].getAttribute("data-ui-command")).toBe("view.direction");
  });
  it("表示と操作モードを切り替え、状態別の青色classを保つ", () => {
    render(<Fixture code={true} preview="off" />);
    fireEvent.click(screen.getByRole("button", { name: "ビジュアル" }));
    expect(screen.getByTestId("state").textContent).toContain('"preview":"preview"');
    expect(document.querySelector('[data-ui-command="view.visual"].is-active')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    expect(screen.getByTestId("state").textContent).toContain('"interactionMode":"edit"');
    expect(screen.getByTestId("state").textContent).toContain('"preview":"visual"');
    expect(document.querySelector('[data-ui-command="view.visual"].is-active')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "閲覧" }));
    expect(screen.getByTestId("state").textContent).toContain('"interactionMode":"browse"');
    expect(screen.getByTestId("state").textContent).toContain('"preview":"preview"');
  });
  it("表示モードのコードを選ぶとコードだけを表示する", () => {
    render(<Fixture code={false} preview="visual" />);
    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    expect(screen.getByTestId("state").textContent).toContain('"code":true');
    fireEvent.change(screen.getByLabelText("分割方向"), { target: { value: "horizontal" } });
    expect((screen.getByLabelText("分割方向") as HTMLSelectElement).value).toBe("horizontal");
  });
  it("無効状態では操作を受け付けない", () => {
    render(<Fixture disabled />);
    expect((screen.getByRole("button", { name: "コード" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "ビジュアル" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
