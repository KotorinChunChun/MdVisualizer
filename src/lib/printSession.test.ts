import { describe, expect, it, vi } from "vitest";
import { createIdempotentPrintRestorer, waitForMermaidPrintReady } from "./printSession";

describe("print session", () => {
  it("restores a snapshot only once when afterprint and timeout both fire", () => {
    const snapshot = { tabId: "tab-1", scrollTop: 240, viewMode: "preview" };
    const getSnapshot = vi.fn(() => snapshot);
    const onRestore = vi.fn();
    const restore = createIdempotentPrintRestorer(getSnapshot, onRestore);

    expect(restore()).toBe(true);
    expect(restore()).toBe(false);
    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledWith(snapshot);
  });

  it("does not invoke restoration when an exception path has no snapshot", () => {
    const onRestore = vi.fn();
    const restore = createIdempotentPrintRestorer(() => null, onRestore);

    expect(restore()).toBe(true);
    expect(restore()).toBe(false);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("returns immediately when Mermaid is idle", async () => {
    await expect(waitForMermaidPrintReady(() => ({ pending: 0 }))).resolves.toEqual({ timedOut: false });
  });

  it("reports a render timeout without throwing", async () => {
    vi.useFakeTimers();
    const promise = waitForMermaidPrintReady(() => ({ pending: 1 }), 100, 10);
    await vi.advanceTimersByTimeAsync(110);
    await expect(promise).resolves.toEqual({ timedOut: true });
    vi.useRealTimers();
  });

  it("allows the caller to continue when Mermaid status fails", async () => {
    await expect(waitForMermaidPrintReady(() => { throw new Error("status unavailable"); })).rejects.toThrow("status unavailable");
  });
});
