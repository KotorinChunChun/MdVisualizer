import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentDiffModal } from "./DocumentDiffModal";

afterEach(cleanup);

describe("DocumentDiffModal", () => {
  it("shows two panes when storage still matches the opened content", () => {
    render(<DocumentDiffModal
      target={{ path: "C:\\docs\\note.md", baseDir: "C:\\docs", openedContent: "old", storageContent: "old", editingContent: "new" }}
      theme="dark"
      onClose={vi.fn()}
    />);
    expect(screen.getByText(/2-way/)).toBeTruthy();
    expect(screen.getByText("開いた時点／ストレージ最新版")).toBeTruthy();
    expect(screen.getByText("編集中")).toBeTruthy();
  });

  it("shows three panes and supports rendered diff display", () => {
    render(<DocumentDiffModal
      target={{ path: "C:\\docs\\note.md", baseDir: "C:\\docs", openedContent: "# Base", storageContent: "# Storage", editingContent: "# Editing" }}
      theme="dark"
      onClose={vi.fn()}
    />);
    expect(screen.getByText(/3-way/)).toBeTruthy();
    expect(screen.getByText("開いた時点")).toBeTruthy();
    expect(screen.getByText("ストレージ最新版")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "レンダリング" }));
    expect(document.querySelectorAll(".document-diff__rendered")).toHaveLength(3);
    expect(document.querySelectorAll(".markdown-diff-line").length).toBeGreaterThan(0);
  });
});
