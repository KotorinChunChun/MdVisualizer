import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";

const document = {
  path: "C:\\docs\\sample.md",
  content: "# Sample",
  base_dir: "C:\\docs",
  image_paths: [],
  encoding: "UTF-8",
  size_bytes: 1536,
  modified_at: "2026-07-29 12:00",
};

describe("StatusBar", () => {
  afterEach(cleanup);

  it("shows document state and the supplied status summaries", () => {
    render(<StatusBar document={document} changed mermaidStatus="描画済み" mermaidErrorCount={2} imageBackupAvailable />);

    expect(screen.queryByText("sample.md")).toBeNull();
    expect(screen.getByText("1.5 KB")).toBeTruthy();
    expect(screen.getByText("変更あり")).toBeTruthy();
    expect(screen.getByText("Mermaid: 描画済み (2件のエラー)")).toBeTruthy();
    expect(screen.getByText("画像バックアップあり")).toBeTruthy();
  });

  it("uses controlled callbacks for all status-bar selects", () => {
    const onAutoReloadChange = vi.fn();
    const onMermaidModeChange = vi.fn();
    const onZoomChange = vi.fn();
    const onThemeChange = vi.fn();
    const onViewModeChange = vi.fn();
    render(<StatusBar document={document} onAutoReloadChange={onAutoReloadChange} onMermaidModeChange={onMermaidModeChange} onZoomChange={onZoomChange} onThemeChange={onThemeChange} onViewModeChange={onViewModeChange} />);

    fireEvent.change(screen.getByLabelText("テーマ"), { target: { value: "light" } });
    fireEvent.change(screen.getByLabelText("レイアウト"), { target: { value: "wide" } });
    fireEvent.change(screen.getByLabelText("Auto Reload"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("Mermaid"), { target: { value: "error-code" } });
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "120" } });

    expect(onAutoReloadChange).toHaveBeenCalledWith("manual");
    expect(onMermaidModeChange).toHaveBeenCalledWith("error-code");
    expect(onZoomChange).toHaveBeenCalledWith(120);
    expect(onThemeChange).toHaveBeenCalledWith("light");
    expect(onViewModeChange).toHaveBeenCalledWith("wide");
  });

  it("keeps legacy callers working while disabling unbound controls", () => {
    render(<StatusBar document={null} />);

    expect(screen.getByText("Markdownファイル未選択")).toBeTruthy();
    expect((screen.getByLabelText("Auto Reload") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Mermaid") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Zoom") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("テーマ") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("レイアウト") as HTMLSelectElement).disabled).toBe(true);
  });

  it("opens the settings tab from the rightmost gear button", () => {
    const onOpenSettings = vi.fn();
    render(<StatusBar document={null} statusText="設定" onOpenSettings={onOpenSettings} />);

    expect(screen.getByText("設定")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "設定を開く" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("opens shortcut help from a question button immediately left of settings", () => {
    const onOpenShortcutHelp = vi.fn();
    const onOpenSettings = vi.fn();
    render(<StatusBar document={null} onOpenShortcutHelp={onOpenShortcutHelp} onOpenSettings={onOpenSettings} />);

    const help = screen.getByRole("button", { name: "ショートカット一覧を開く" });
    const settings = screen.getByRole("button", { name: "設定を開く" });
    expect(help.nextElementSibling).toBe(settings);
    fireEvent.click(help);
    expect(onOpenShortcutHelp).toHaveBeenCalledOnce();
  });
});
