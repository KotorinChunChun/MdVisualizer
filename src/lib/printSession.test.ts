import { describe, expect, it, vi } from "vitest";
import { waitForMermaidPrintReady } from "./printSession";

describe("print session", () => {
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
