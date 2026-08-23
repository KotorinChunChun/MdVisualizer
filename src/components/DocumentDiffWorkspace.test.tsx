import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWorkspaceDiffPanes, DocumentDiffWorkspace, type DocumentDiffTarget } from "./DocumentDiffWorkspace";

afterEach(cleanup);

const target: DocumentDiffTarget = {
  path: "C:\\docs\\note.md",
  baseDir: "C:\\docs",
  openedContent: "# Opened",
  storageContent: "# Opened",
  editingContent: "# Editing",
};

describe("DocumentDiffWorkspace", () => {
  it("uses storage/opened/current code columns in edit mode", () => {
    const threeWay = buildWorkspaceDiffPanes({ ...target, storageContent: "# Storage" }, "edit");
    expect(threeWay.mode).toBe("three-way");
    expect(threeWay.panes.map((pane) => [pane.label, pane.display])).toEqual([
      ["ストレージ", "code"], ["起動時", "code"], ["現在", "code"],
    ]);
  });

  it("collapses unchanged storage and opened content into a two-way rendered view", () => {
    const twoWay = buildWorkspaceDiffPanes(target, "preview");
    expect(twoWay.mode).toBe("two-way");
    expect(twoWay.panes.map((pane) => [pane.label, pane.display])).toEqual([
      ["ストレージ／起動時", "rendered"], ["現在", "rendered"],
    ]);
  });

  it("uses the requested four-column layout in split mode", () => {
    render(<DocumentDiffWorkspace target={target} editorMode="split" theme="dark" />);
    expect(screen.getByText("起動時レンダリング")).toBeTruthy();
    expect(screen.getByText("起動時コード")).toBeTruthy();
    expect(screen.getByText("現在のコード")).toBeTruthy();
    expect(screen.getByText("現在のレンダリング")).toBeTruthy();
    expect(document.querySelectorAll(".document-diff__pane")).toHaveLength(4);
    expect(document.querySelectorAll(".document-diff .mermaid-container, .document-diff .drawio-block")).toHaveLength(0);
  });

  it("adopts one storage change hunk into the editing content", async () => {
    const onEditingChange = vi.fn();
    render(<DocumentDiffWorkspace
      target={{ ...target, openedContent: "a\nb\nc", storageContent: "a\nstorage\nc", editingContent: "a\nediting\nc" }}
      editorMode="edit"
      theme="dark"
      onEditingChange={onEditingChange}
    />);
    fireEvent.click(screen.getByRole("button", { name: /行変更を採用/ }));
    expect(onEditingChange).toHaveBeenCalledWith("a\nstorage\nc");
    expect(await screen.findByLabelText("Markdown編集")).toBeTruthy();
  });

  it("shows an explicit overwrite action only for a save conflict", () => {
    const onOverwrite = vi.fn();
    render(<DocumentDiffWorkspace target={{ ...target, conflict: true, storageRevision: "r2" }} editorMode="preview" theme="dark" onOverwrite={onOverwrite} />);
    fireEvent.click(screen.getByRole("button", { name: "確認した内容で上書き保存" }));
    expect(onOverwrite).toHaveBeenCalledOnce();
    expect(screen.getByText(/保存競合/)).toBeTruthy();
  });
});
