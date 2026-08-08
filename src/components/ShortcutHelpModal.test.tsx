import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutHelpModal } from "./ShortcutHelpModal";
import { openExternalUrl } from "../lib/commands";

vi.mock("../lib/commands", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

describe("ShortcutHelpModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists the new shortcuts and closes with Escape", () => {
    const onClose = vi.fn();
    render(<ShortcutHelpModal onClose={onClose} />);
    expect(screen.getByText("Ctrl + + / Ctrl + ;")).toBeTruthy();
    expect(screen.getByText("Ctrl + ?")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows version information and opens project links through the safe command", () => {
    render(<ShortcutHelpModal onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "バージョン情報" })).toBeTruthy();
    expect(screen.getByText("2026-08-09")).toBeTruthy();
    expect(screen.getByText("0.0.6")).toBeTruthy();
    expect(screen.getByText("KotorinChunChun")).toBeTruthy();

    const readme = screen.getByRole("link", { name: "READMEを開く" });
    const releases = screen.getByRole("link", { name: "リリースを開く" });
    expect(readme.getAttribute("href")).toBe("https://github.com/KotorinChunChun/MarkdownViewer#readme");
    expect(releases.getAttribute("href")).toBe("https://github.com/KotorinChunChun/MarkdownViewer/releases");

    fireEvent.click(readme);
    fireEvent.click(releases);
    expect(openExternalUrl).toHaveBeenNthCalledWith(1, "https://github.com/KotorinChunChun/MarkdownViewer#readme");
    expect(openExternalUrl).toHaveBeenNthCalledWith(2, "https://github.com/KotorinChunChun/MarkdownViewer/releases");
  });
});
