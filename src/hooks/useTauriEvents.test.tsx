import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTauriEvents, type FileChangedPayload } from "./useTauriEvents";

type Listener = (event: { payload: FileChangedPayload }) => void;

const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }));
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

const payload: FileChangedPayload = { windowLabel: "main", path: "C:\\docs\\sample.md", changeKind: "modified" };

describe("useTauriEvents", () => {
  afterEach(() => {
    listeners.clear();
    listenMock.mockReset();
  });

  it("removes a listener that resolves after the component has unmounted", async () => {
    let resolveMarkdown!: (unlisten: () => void) => void;
    const unlistenMarkdown = vi.fn();
    listenMock.mockImplementationOnce((_name: string, listener: Listener) => {
      listeners.set("markdown-changed", listener);
      return new Promise<() => void>((resolve) => { resolveMarkdown = resolve; });
    });

    const { unmount } = renderHook(() => useTauriEvents(vi.fn(), vi.fn()));
    unmount();
    await act(async () => { resolveMarkdown(unlistenMarkdown); });

    expect(unlistenMarkdown).toHaveBeenCalledOnce();
    expect(listenMock).toHaveBeenCalledTimes(1);
  });

  it("subscribes once and calls the latest callbacks after rerender", async () => {
    const firstMarkdown = vi.fn();
    const nextMarkdown = vi.fn();
    const firstImage = vi.fn();
    const nextImage = vi.fn();
    const unlistenMarkdown = vi.fn();
    const unlistenImage = vi.fn();
    listenMock.mockImplementation((name: string, listener: Listener) => {
      listeners.set(name, listener);
      return Promise.resolve(name === "markdown-changed" ? unlistenMarkdown : unlistenImage);
    });

    const { rerender, unmount } = renderHook(
      ({ markdown, image }) => useTauriEvents(markdown, image),
      { initialProps: { markdown: firstMarkdown, image: firstImage } },
    );
    await act(async () => {});
    rerender({ markdown: nextMarkdown, image: nextImage });
    act(() => {
      listeners.get("markdown-changed")?.({ payload });
      listeners.get("image-changed")?.({ payload });
    });

    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(firstMarkdown).not.toHaveBeenCalled();
    expect(firstImage).not.toHaveBeenCalled();
    expect(nextMarkdown).toHaveBeenCalledWith(payload);
    expect(nextImage).toHaveBeenCalledWith(payload);

    unmount();
    expect(unlistenMarkdown).toHaveBeenCalledOnce();
    expect(unlistenImage).toHaveBeenCalledOnce();
  });

  it("handles subscription failures without an unhandled rejection", async () => {
    const error = new Error("unavailable");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listenMock.mockRejectedValueOnce(error);

    renderHook(() => useTauriEvents(vi.fn(), vi.fn()));
    await act(async () => {});

    expect(errorSpy).toHaveBeenCalledWith("Failed to subscribe to Tauri file events:", error);
    errorSpy.mockRestore();
  });
});
