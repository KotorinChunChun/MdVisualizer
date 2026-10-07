import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexLogViewer } from "./CodexLogViewer";
import type { CodexLogData } from "./model";

const record = (id: string): CodexLogData["entries"][number] => ({ id, createdAt: "2026-10-08T00:00:00Z", model: `model-${id}`, requestPrompt: `CONTROL\nUSER-${id}`, responseText: `応答-${id}`, responseRaw: JSON.stringify({ type: "item.completed", id }), inputTokens: 10, cachedInputTokens: null, outputTokens: 5, userPrompt: `USER-${id}`, controlPrompt: "CONTROL", requestSettings: { arguments: ["exec", "--json"] }, requestImages: [{ base64: `INPUT-${id}`, mime: "image/png", filename: `before-${id}.png` }], responseImages: [{ base64: `OUTPUT-${id}`, mime: "image/png", filename: `after-${id}.png` }], stderr: `diagnostic-${id}` });
const data: CodexLogData = { limit: 20, entries: [record("A"), record("B")] };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function chooseB() { fireEvent.click(within(screen.getByRole("navigation", { name: "AI通信記録一覧" })).getAllByRole("button")[1]); }
function readBlob(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob); }); }
beforeEach(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("B03 通信記録の非同期出力と再操作", () => {
  it("B03-N14 Aの生データコピー待ちにBを選んでもBをコピーしたと誤表示しない", async () => {
    const gate = deferred<void>(); vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(gate.promise);
    render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "生データをコピー" })); chooseB(); await act(async () => { gate.resolve(); });
    expect(JSON.parse(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0])).toEqual(data.entries[0]);
    const status = screen.queryByRole("status");
    // 別記録へ切り替えたら旧完了表示を抑止するか、Aの操作と識別できる必要がある。
    if (status) expect(status.textContent).toMatch(/A|前の|別の/);
    expect(screen.getByRole("main", { name: "選択したAI通信記録" })).toHaveTextContent("USER-B");
  });
  it("B03-N15 生データコピー失敗後も記録と画像を保ち同じJSONで再試行できる", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("clipboard拒否"));
    render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "生データをコピー" })); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("コピーできません"));
    expect(screen.getByAltText("before-A.png")).toHaveAttribute("src", "data:image/png;base64,INPUT-A");
    fireEvent.click(screen.getByRole("button", { name: "生データをコピー" })); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("コピーしました"));
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls.map(([json]) => JSON.parse(json))).toEqual([data.entries[0], data.entries[0]]);
  });
  it("B03-N14補助 AからBを経てAへ戻っても古いコピーの完了表示を復活させない", async () => {
    const gate = deferred<void>(); vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(gate.promise);
    render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "生データをコピー" })); chooseB();
    fireEvent.click(within(screen.getByRole("navigation", { name: "AI通信記録一覧" })).getAllByRole("button")[0]);
    await act(async () => { gate.resolve(); }); expect(screen.queryByRole("status")).toBeNull();
  });
  it("B03-N14補助 同じ記録の新しいコピー失敗を古いコピー成功で上書きしない", async () => {
    const old = deferred<void>(); vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error("今回のコピー拒否"));
    render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "生データをコピー" })); fireEvent.click(screen.getByRole("button", { name: "生データをコピー" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("コピーできません"));
    await act(async () => { old.resolve(); }); expect(screen.getByRole("status")).toHaveTextContent("コピーできません");
  });
  it("B03-N16 2記録のJSON書出しで選択内容とBlobを取り違えない（実WebView取得は別受入）", async () => {
    const blobs: Blob[] = [], downloads: { href: string; name: string }[] = [], revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: (blob: Blob) => { blobs.push(blob); return `blob:fixture-${blobs.length}`; }, revokeObjectURL: revoke }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ href: this.href, name: this.download }); });
    render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn()} />);
    vi.useFakeTimers(); fireEvent.click(screen.getByRole("button", { name: "JSONを書き出す" })); chooseB(); fireEvent.click(screen.getByRole("button", { name: "JSONを書き出す" }));
    expect(downloads).toEqual([{ href: "blob:fixture-1", name: "codex-communication-A.json" }, { href: "blob:fixture-2", name: "codex-communication-B.json" }]);
    expect(revoke).not.toHaveBeenCalled(); vi.advanceTimersByTime(1000); expect(revoke.mock.calls).toEqual([["blob:fixture-1"], ["blob:fixture-2"]]); vi.useRealTimers();
    expect(await Promise.all(blobs.map(async blob => JSON.parse(await readBlob(blob))))).toEqual(data.entries);
  });
  it("B03-N17 通信ログ件数の保存失敗を示して現在一覧を保ち同じ値で再試行できる", async () => {
    const saveLimit = vi.fn<(_: number) => Promise<void>>().mockRejectedValueOnce(new Error("上限保存失敗")).mockResolvedValue(undefined);
    const view = render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={saveLimit} />);
    const input = screen.getByLabelText("通信ログの最大件数"); fireEvent.change(input, { target: { value: "1" } }); fireEvent.blur(input);
    // 製品側で失敗を表示する。fixtureでrejectionを握りつぶさない。
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("上限保存失敗"));
    expect(within(screen.getByRole("navigation", { name: "AI通信記録一覧" })).getAllByRole("button")).toHaveLength(2);
    fireEvent.blur(input); await waitFor(() => expect(saveLimit).toHaveBeenCalledTimes(2));
    view.rerender(<CodexLogViewer data={{ limit: 1, entries: [data.entries[0]] }} onClose={vi.fn()} onLimitChange={saveLimit} />);
    expect(input).toHaveValue("1"); expect(within(screen.getByRole("navigation", { name: "AI通信記録一覧" })).getAllByRole("button")).toHaveLength(1);
  });
  it("B03-N17補助 Enterとblurが続いても保存は一度で失敗後は同じ入力を再保存できる", async () => {
    const gate = deferred<void>(), save = vi.fn<(_: number) => Promise<void>>().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={save} />);
    const input = screen.getByLabelText("通信ログの最大件数"); fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" }); fireEvent.blur(input); expect(save).toHaveBeenCalledTimes(1); expect(input).toBeDisabled();
    await act(async () => { gate.reject(new Error("保存先へ書けません")); }); expect(screen.getByRole("alert")).toHaveTextContent("保存先へ書けません");
    expect(input).toHaveValue("7"); expect(input).toBeEnabled(); expect(data.entries).toHaveLength(2);
    fireEvent.keyDown(input, { key: "Enter" }); await waitFor(() => expect(input).toBeEnabled());
    expect(save.mock.calls).toEqual([[7], [7]]); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("B03-N17補助 閉じた画面の遅い保存失敗を新しい画面へ混在させない", async () => {
    const gate = deferred<void>(), oldSave = vi.fn().mockReturnValue(gate.promise);
    const old = render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={oldSave} />);
    fireEvent.change(screen.getByLabelText("通信ログの最大件数"), { target: { value: "1" } }); fireEvent.blur(screen.getByLabelText("通信ログの最大件数")); old.unmount();
    render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn().mockResolvedValue(undefined)} />);
    await act(async () => { gate.reject(new Error("閉じた画面の失敗")); }); expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("通信ログの最大件数")).toHaveValue("20"); expect(screen.getByLabelText("通信ログの最大件数")).toBeEnabled();
  });
});
