import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

vi.mock("../lib/commands", () => ({ openContainingFolder: vi.fn(), openInEditor: vi.fn() }));

const tab = { id: "tab-1", path: "C:\\docs\\sample.md", document: null, error: null, loading: false, scrollTop: 0, generation: 1, draft: "", dirty: false, saving: false, saveError: null, editorMode: "preview" as const, imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } };

describe("ContextMenu", () => {
  it("dismisses when focus leaves the menu", () => {
    const onDismiss = vi.fn();
    render(<ContextMenu tab={tab} x={0} y={0} onDismiss={onDismiss} onClose={() => {}} onCloseOthers={() => {}} onCloseRight={() => {}} onNewWindow={() => {}} onError={() => {}} />);
    fireEvent.blur(screen.getByText("タブを閉じる").closest(".context-menu")!, { relatedTarget: document.body });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
