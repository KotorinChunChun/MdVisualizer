import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("closes a tab when its middle button is clicked", () => {
    const onClose = vi.fn();
    render(<TabBar tabs={[{ id: "tab-1", path: "C:\\docs\\sample.md", document: null, error: null, loading: false, scrollTop: 0, generation: 1, imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } }]} activeId="tab-1" onActivate={() => {}} onClose={onClose} onMove={() => {}} onContext={() => {}} />);

    fireEvent(screen.getByTitle("C:\\docs\\sample.md"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenCalledWith("tab-1");
  });

  it("shows a singleton settings tab without a document context menu", () => {
    const onContext = vi.fn();
    render(<TabBar tabs={[{ id: "settings", kind: "settings", path: "__settings__", document: null, error: null, loading: false, scrollTop: 0, generation: 1, imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } }]} activeId="settings" onActivate={() => {}} onClose={() => {}} onMove={() => {}} onContext={onContext} />);

    fireEvent.contextMenu(screen.getByText("⚙ 設定"));
    expect(onContext).not.toHaveBeenCalled();
  });
});
