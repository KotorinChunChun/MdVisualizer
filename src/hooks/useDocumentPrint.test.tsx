import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentPrint } from "./useDocumentPrint";

describe("document print lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 1));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(["afterprint", "cancel", "timeout", "throw"])("%s後に開始時の表示・スクロールを一度だけ復元する", async (outcome) => {
    const viewport = document.createElement("div");
    viewport.scrollTop = 240;
    let viewMode = "presentation";
    const restore = vi.fn((snapshot: { scrollTop: number; viewMode: string }) => {
      viewport.scrollTop = snapshot.scrollTop;
      viewMode = snapshot.viewMode;
    });
    const onError = vi.fn();
    const print = vi.fn(() => {
      viewport.scrollTop = 0;
      viewMode = "auto";
      if (outcome === "throw") throw new Error("printer unavailable");
      if (outcome !== "timeout") window.dispatchEvent(new Event("afterprint"));
    });
    const { result } = renderHook(() => useDocumentPrint({
      getSnapshot: () => ({ scrollTop: viewport.scrollTop, viewMode }), restore,
      print, onError, onInfo: vi.fn(), waitForDiagrams: async () => ({ timedOut: false }),
    }));
    let completion!: Promise<void>;
    act(() => { completion = result.current.printDocument(); void result.current.printDocument(); });
    expect(result.current.printing).toBe(true);
    expect(result.current.printStartedAt).toBeInstanceOf(Date);
    await act(async () => { await vi.runAllTimersAsync(); await completion; });
    window.dispatchEvent(new Event("afterprint"));
    expect(print).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(viewport.scrollTop).toBe(240);
    expect(viewMode).toBe("presentation");
    expect(result.current.printing).toBe(false);
    expect(result.current.printStartedAt).toBeNull();
    expect(onError).toHaveBeenCalledTimes(outcome === "throw" ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["timeout", "error"])("Mermaid待機の%sを通知してPDF出力を継続する", async (reason) => {
    const onInfo = vi.fn();
    const print = vi.fn(() => { window.dispatchEvent(new Event("afterprint")); });
    const { result } = renderHook(() => useDocumentPrint({
      getSnapshot: () => "snapshot", restore: vi.fn(), print, onInfo, onError: vi.fn(),
      waitForDiagrams: async () => { if (reason === "error") throw new Error("diagram error"); return { timedOut: true }; },
    }));
    await act(async () => {
      const completion = result.current.printDocument();
      await vi.runAllTimersAsync();
      await completion;
    });
    expect(onInfo).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
    expect(result.current.printing).toBe(false);
  });
});
