import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileDrop } from "./useFileDrop";

const { onDragDropEvent } = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

describe("useFileDrop", () => {
  afterEach(() => onDragDropEvent.mockReset());

  it("opens Markdown files from a WebView drop and removes the listener", async () => {
    const unlisten = vi.fn();
    let listener!: (event: { payload: { type: "drop"; paths: string[] } }) => void;
    onDragDropEvent.mockImplementation((callback) => {
      listener = callback;
      return Promise.resolve(unlisten);
    });
    const onDrop = vi.fn();
    const { unmount } = renderHook(() => useFileDrop(onDrop));
    await act(async () => {});
    act(() => listener({ payload: { type: "drop", paths: ["C:\\a.md", "C:\\x.png", "C:\\b.markdown"] } }));

    expect(onDrop).toHaveBeenCalledWith(["C:\\a.md", "C:\\b.markdown"]);
    unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
