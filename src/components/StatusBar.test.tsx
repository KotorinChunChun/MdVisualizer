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

    expect(screen.getByText("sample.md")).toBeTruthy();
    expect(screen.getByText("1.5 KB")).toBeTruthy();
    expect(screen.getByText("変更あり")).toBeTruthy();
    expect(screen.getByText("Mermaid: 描画済み (2件のエラー)")).toBeTruthy();
    expect(screen.getByText("画像バックアップあり")).toBeTruthy();
  });

  it("uses controlled callbacks for all status-bar selects", () => {
    const onAutoReloadChange = vi.fn();
    const onMermaidModeChange = vi.fn();
    const onZoomChange = vi.fn();
    render(<StatusBar document={document} onAutoReloadChange={onAutoReloadChange} onMermaidModeChange={onMermaidModeChange} onZoomChange={onZoomChange} />);

    fireEvent.change(screen.getByLabelText("Auto Reload"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("Mermaid"), { target: { value: "error-code" } });
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "125" } });

    expect(onAutoReloadChange).toHaveBeenCalledWith("manual");
    expect(onMermaidModeChange).toHaveBeenCalledWith("error-code");
    expect(onZoomChange).toHaveBeenCalledWith(125);
  });

  it("keeps legacy callers working while disabling unbound controls", () => {
    render(<StatusBar document={null} />);

    expect(screen.getByText("Markdownファイル未選択")).toBeTruthy();
    expect((screen.getByLabelText("Auto Reload") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Mermaid") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Zoom") as HTMLSelectElement).disabled).toBe(true);
  });
});
