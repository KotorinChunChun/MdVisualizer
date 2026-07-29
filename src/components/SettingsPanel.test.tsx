import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTERNAL_APPS } from "../types/settings";
import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  afterEach(cleanup);

  it("edits placement and saves a normalized draft", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} onSave={onSave} />);
    fireEvent.change(screen.getAllByLabelText("表示場所")[2], { target: { value: "primary" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0][2].placement).toBe("primary");
  });

  it("keeps built-ins undeletable and validates custom executable", async () => {
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} onSave={vi.fn()} />);
    expect((screen.getAllByRole("button", { name: "削除" })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "アプリを追加" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain("実行ファイル");
  });
});
