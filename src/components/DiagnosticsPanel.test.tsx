import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsPanel, type DiagnosticItem } from "./DiagnosticsPanel";

afterEach(cleanup);

const items: DiagnosticItem[] = [
  { severity: "error", kind: "画像", line: 3, reference: "missing.png", message: "画像が見つかりません。" },
  { severity: "warning", kind: "見出し", line: 8, reference: "見出し", message: "見出しIDが重複しています。" },
];

describe("DiagnosticsPanel", () => {
  it("announces counts and restores focus after Escape", () => {
    const onOpenChange = vi.fn();
    render(<DiagnosticsPanel items={items} isOpen onOpenChange={onOpenChange} onSelect={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "文書診断" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: "診断 (2)" }).getAttribute("aria-controls")).toBe(dialog.id);
    expect(screen.getByText("エラー1件、警告1件")).toBeTruthy();
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("エラー1件、警告1件"))).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "診断を閉じる" }));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
