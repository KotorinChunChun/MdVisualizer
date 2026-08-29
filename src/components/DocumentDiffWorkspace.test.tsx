import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWorkspaceDiffPanes, DocumentDiffWorkspace, synchronizedDiffScrollTop, type DocumentDiffTarget } from "./DocumentDiffWorkspace";

afterEach(cleanup);

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const target: DocumentDiffTarget = {
  path: "C:\\docs\\note.md",
  baseDir: "C:\\docs",
  openedContent: "# Opened",
  storageContent: "# Opened",
  editingContent: "# Editing",
};

describe("DocumentDiffWorkspace", () => {
  it("maps the relative scroll position between different pane heights", () => {
    expect(synchronizedDiffScrollTop(
      { scrollTop: 250, scrollHeight: 600, clientHeight: 100 },
      { scrollTop: 0, scrollHeight: 1200, clientHeight: 200 },
    )).toBe(500);
    expect(synchronizedDiffScrollTop(
      { scrollTop: 50, scrollHeight: 100, clientHeight: 100 },
      { scrollTop: 0, scrollHeight: 1200, clientHeight: 200 },
    )).toBe(0);
  });

  it("uses storage/saved/current code columns in edit mode", () => {
    const threeWay = buildWorkspaceDiffPanes({ ...target, storageContent: "# Storage" }, "edit");
    expect(threeWay.mode).toBe("three-way");
    expect(threeWay.panes.map((pane) => [pane.label, pane.display])).toEqual([
      ["ストレージ", "code"], ["保存済み", "code"], ["現在", "code"],
    ]);
  });

  it("collapses unchanged storage and opened content into a two-way rendered view", () => {
    const twoWay = buildWorkspaceDiffPanes(target, "preview");
    expect(twoWay.mode).toBe("two-way");
    expect(twoWay.panes.map((pane) => [pane.label, pane.display])).toEqual([
      ["ストレージ／保存済み", "rendered"], ["現在", "rendered"],
    ]);
  });

  it("uses the requested four-column layout in split mode", () => {
    render(<DocumentDiffWorkspace target={target} editorMode="split" theme="dark" />);
    expect(screen.getByText("保存済みレンダリング")).toBeTruthy();
    expect(screen.getByText("保存済みコード")).toBeTruthy();
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
    expect(await screen.findByLabelText("Markdown編集", {}, { timeout: 5_000 })).toBeTruthy();
  });

  it("routes an adopted storage hunk to the persistence callback", () => {
    const onAdopt = vi.fn();
    render(<DocumentDiffWorkspace
      target={{ ...target, openedContent: "a\nb\nc", storageContent: "a\nstorage\nc", editingContent: "a\nediting\nc" }}
      editorMode="preview"
      theme="dark"
      onAdopt={onAdopt}
    />);
    fireEvent.click(screen.getByRole("button", { name: /行変更を採用/ }));
    expect(onAdopt).toHaveBeenCalledWith("a\nstorage\nc");
  });

  it("shows an explicit overwrite action only for a save conflict", () => {
    const onOverwrite = vi.fn();
    render(<DocumentDiffWorkspace target={{ ...target, conflict: true, storageRevision: "r2" }} editorMode="preview" theme="dark" onOverwrite={onOverwrite} />);
    fireEvent.click(screen.getByRole("button", { name: "確認した内容で上書き保存" }));
    expect(onOverwrite).toHaveBeenCalledOnce();
    expect(screen.getByText(/保存競合/)).toBeTruthy();
  });

  it("synchronizes scrolling across rendered DIFF panes", () => {
    const { container } = render(<DocumentDiffWorkspace target={target} editorMode="preview" theme="dark" />);
    const panes = [...container.querySelectorAll<HTMLElement>(".document-diff__rendered")];
    expect(panes).toHaveLength(2);
    Object.defineProperties(panes[0], { scrollHeight: { value: 600 }, clientHeight: { value: 100 } });
    Object.defineProperties(panes[1], { scrollHeight: { value: 1200 }, clientHeight: { value: 200 } });
    panes[0].scrollTop = 250;

    fireEvent.scroll(panes[0]);

    expect(panes[1].scrollTop).toBe(500);
  });

  it("maps a clicked old line to the current editor and highlights both versions", async () => {
    const { container } = render(<DocumentDiffWorkspace
      target={{ ...target, openedContent: "# a\n\n# b", storageContent: "# a\n\n# b", editingContent: "inserted\n# a\n\n# b" }}
      editorMode="split"
      theme="dark"
      onEditingChange={() => {}}
    />);
    const openedCodeLines = container.querySelectorAll<HTMLElement>('[data-pane-key="opened-code"] li');

    fireEvent.click(openedCodeLines[2]);

    await waitFor(() => expect(container.querySelector(".cm-activeLine")?.textContent).toBe("# b"), { timeout: 5_000 });
    await waitFor(() => {
      expect(openedCodeLines[2].classList.contains("is-current")).toBe(true);
      const openedHeadings = container.querySelectorAll<HTMLElement>('[data-pane-key="opened-rendered"] h1');
      const editingHeadings = container.querySelectorAll<HTMLElement>('[data-pane-key="editing-rendered"] h1');
      expect(openedHeadings[openedHeadings.length - 1]?.classList.contains("is-editor-current-line")).toBe(true);
      expect(editingHeadings[editingHeadings.length - 1]?.classList.contains("is-editor-current-line")).toBe(true);
    }, { timeout: 5_000 });
  });

  it("highlights the exact table row selected by the Edit cursor", async () => {
    const table = "| name | value |\n| --- | --- |\n| first | 1 |\n| second | 2 |";
    const { container } = render(<DocumentDiffWorkspace
      target={{ ...target, openedContent: table, storageContent: table, editingContent: table }}
      editorMode="split"
      theme="dark"
      onEditingChange={() => {}}
    />);
    const openedCodeLines = container.querySelectorAll<HTMLElement>('[data-pane-key="opened-code"] li');

    fireEvent.click(openedCodeLines[3]);

    await waitFor(() => {
      expect(container.querySelector('[data-pane-key="opened-rendered"] tr[data-source-line="4"]')?.classList.contains("is-editor-current-line")).toBe(true);
      expect(container.querySelector('[data-pane-key="editing-rendered"] tr[data-source-line="4"]')?.classList.contains("is-editor-current-line")).toBe(true);
    }, { timeout: 5_000 });
  });

});
