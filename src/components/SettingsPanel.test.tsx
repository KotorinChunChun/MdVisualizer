import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTERNAL_APPS } from "../types/settings";
import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  afterEach(cleanup);

  it("edits placement and saves a normalized draft", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} onSave={onSave} />);
    fireEvent.change(screen.getAllByLabelText("表示場所")[2], { target: { value: "primary" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0][2].placement).toBe("primary");
    expect(onSave.mock.calls[0][1]).toBe(10);
    expect(onSave.mock.calls[0][2]).toBe(3508);
    expect(onSave.mock.calls[0][3]).toBe(32);
    expect(onSave.mock.calls[0][4]).toMatchObject({ theme: "adaptive", customColors: false });
    expect(onSave.mock.calls[0][5]).toMatchObject({ headingColor: "#1f2328", monochrome: false });
  });

  it("keeps required built-ins undeletable and validates a new document app", async () => {
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} onSave={vi.fn()} />);
    expect((screen.getAllByRole("button", { name: "削除" })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "文書用アプリを追加" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain("実行ファイル");
  });

  it("separates document and image apps, with the Paint direct action editable", () => {
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} onSave={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "文書用アプリ" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "画像用アプリ" })).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "削除" }) as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
    expect(buttons[2].disabled).toBe(false);
    expect(buttons[3].disabled).toBe(false);
  });

  it("adds image apps to the image section and orders them independently", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "画像用アプリを追加" }));
    const executableInputs = screen.getAllByLabelText("実行ファイル");
    fireEvent.change(executableInputs[executableInputs.length - 1], { target: { value: "image-tool.exe" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].find((app: typeof DEFAULT_EXTERNAL_APPS[number]) => app.executable === "image-tool.exe")?.target).toBe("image");
  });

  it("edits image padding preferences and includes them when saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} imageA4TargetWidth={4000} imageEqualPadding={24} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("A4横の想定横幅"), { target: { value: "4200" } });
    fireEvent.change(screen.getByLabelText("四辺の等間隔余白"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0].slice(2, 4)).toEqual([4200, 40]);
  });

  it("previews and saves a syntax highlighting preset with custom base colors", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("シンタックス配色"), { target: { value: "monokai" } });
    fireEvent.click(screen.getByLabelText("コード基本色を上書き"));
    fireEvent.change(screen.getByLabelText("コード背景色"), { target: { value: "#101010" } });
    fireEvent.change(screen.getByLabelText("コード本文色"), { target: { value: "#f0f0f0" } });
    expect(screen.getByLabelText("シンタックス配色プレビュー").getAttribute("data-syntax-theme")).toBe("monokai");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][4]).toEqual({ theme: "monokai", customColors: true, background: "#101010", foreground: "#f0f0f0" });
  });

  it("previews and saves typed print colors, font, and monochrome mode", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("印刷見出し色"), { target: { value: "#123456" } });
    fireEvent.change(screen.getByLabelText("印刷罫線色"), { target: { value: "#654321" } });
    fireEvent.change(screen.getByLabelText("印刷背景色"), { target: { value: "#eeeeee" } });
    fireEvent.change(screen.getByLabelText("印刷フォント"), { target: { value: "serif" } });
    fireEvent.click(screen.getByLabelText("白黒印刷"));
    expect(screen.getByLabelText("印刷スタイルプレビュー").getAttribute("style")).toContain("rgb(255, 255, 255)");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][5]).toEqual({ headingColor: "#123456", borderColor: "#654321", backgroundColor: "#eeeeee", fontFamily: "serif", monochrome: true });
  });

  it("does not ask users for SharePoint application registration values", () => {
    render(<SettingsPanel apps={DEFAULT_EXTERNAL_APPS} presentationLineThreshold={10} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("SharePointクライアントID")).toBeNull();
    expect(screen.queryByLabelText("SharePointテナント")).toBeNull();
  });
});
