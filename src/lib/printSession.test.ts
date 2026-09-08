import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdempotentPrintRestorer, executePrintSession, waitForMermaidPrintReady } from "./printSession";

afterEach(() => vi.useRealTimers());

describe("print device session", () => {
  it.each(["成功", "取消"])("%sのafterprintから復元しイベントとタイマーを残さない", async () => {
    vi.useFakeTimers();
    const restore = vi.fn();
    const events = new EventTarget();
    const remove = vi.spyOn(events, "removeEventListener");
    const completion = executePrintSession({ restore, events, print: () => { events.dispatchEvent(new Event("afterprint")); } });
    await completion;
    events.dispatchEvent(new Event("afterprint"));
    await vi.runAllTimersAsync();
    expect(restore).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("afterprint", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("afterprintがない場合は期限後に復元する", async () => {
    vi.useFakeTimers();
    const restore = vi.fn();
    const completion = executePrintSession({ restore, print: () => {}, fallbackMs: 100 });
    await vi.advanceTimersByTimeAsync(99);
    expect(restore).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await completion;
    expect(restore).toHaveBeenCalledOnce();
  });

  it.each([false, true])("出力例外でも復元し失敗を呼出元へ返す（非同期=%s）", async (asynchronous) => {
    const restore = vi.fn();
    const failure = new Error("PDF出力先に書き込めません");
    const print = () => { if (asynchronous) return Promise.reject(failure); throw failure; };
    await expect(executePrintSession({ restore, print })).rejects.toBe(failure);
    window.dispatchEvent(new Event("afterprint"));
    expect(restore).toHaveBeenCalledOnce();
  });

  it("PDF作成が継続している間はafterprintと期限を超えてもDOMを保持する", async () => {
    vi.useFakeTimers();
    let finishPdf!: () => void;
    const pdf = new Promise<void>((resolve) => { finishPdf = resolve; });
    const restore = vi.fn();
    const completion = executePrintSession({ restore, print: () => pdf });
    window.dispatchEvent(new Event("afterprint"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restore).not.toHaveBeenCalled();
    finishPdf();
    await completion;
    expect(restore).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

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
