import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  afterEach(cleanup);
  it("closes a tab when its middle button is clicked", () => {
    const onClose = vi.fn();
    render(<TabBar tabs={[{ id: "tab-1", path: "C:\\docs\\sample.md", document: null, error: null, loading: false, scrollTop: 0, generation: 1, draft: "", dirty: false, saving: false, saveError: null, editorMode: "preview", imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } }]} activeId="tab-1" onActivate={() => {}} onClose={onClose} onMove={() => {}} onContext={() => {}} />);

    fireEvent(screen.getByTitle("C:\\docs\\sample.md"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenCalledWith("tab-1");
  });

  it("shows a singleton settings tab without a document context menu", () => {
    const onContext = vi.fn();
    render(<TabBar tabs={[{ id: "settings", kind: "settings", path: "__settings__", document: null, error: null, loading: false, scrollTop: 0, generation: 1, draft: "", dirty: false, saving: false, saveError: null, editorMode: "preview", imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } }]} activeId="settings" onActivate={() => {}} onClose={() => {}} onMove={() => {}} onContext={onContext} />);

    fireEvent.contextMenu(screen.getByText("⚙ 設定"));
    expect(onContext).not.toHaveBeenCalled();
  });

  it("marks a tab that has an unsaved draft", () => {
    render(<TabBar tabs={[{ id: "tab-1", path: "C:\\docs\\sample.md", document: null, error: null, loading: false, scrollTop: 0, generation: 1, draft: "edited", dirty: true, saving: false, saveError: null, editorMode: "preview", imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } }]} activeId="tab-1" onActivate={() => {}} onClose={() => {}} onMove={() => {}} onContext={() => {}} />);

    expect(screen.getByText("sample.md *")).toBeTruthy();
  });

  it("marks a tab whose backing file was deleted", () => {
    render(<TabBar tabs={[{ id: "tab-1", path: "C:\\docs\\sample.md", document: null, deleted: true, error: null, loading: false, scrollTop: 0, generation: 1, draft: "", dirty: true, saving: false, saveError: null, editorMode: "preview", imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } }]} activeId="tab-1" onActivate={() => {}} onClose={() => {}} onMove={() => {}} onContext={() => {}} />);

    expect(screen.getByText("（削除済み）").closest(".tab")?.classList.contains("is-deleted")).toBe(true);
    expect(screen.getByText("（削除済み）")).toBeTruthy();
    expect(screen.queryByText("sample.md *")).toBeNull();
  });
});
