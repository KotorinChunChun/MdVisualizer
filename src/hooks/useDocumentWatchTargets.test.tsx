import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MarkdownLoadResult } from "../types/app";
import { useDocumentWatchTargets } from "./useDocumentWatchTargets";

const mocks = vi.hoisted(() => ({ read: vi.fn(), sync: vi.fn(), remove: vi.fn() }));
vi.mock("../lib/commands", () => ({ documentWatchTargets: mocks.read, syncWatchTargets: mocks.sync, removeWindowWatchTargets: mocks.remove }));
function document(path: string, revision = "r1"): MarkdownLoadResult {
  return { path, revision, kind: "markdown", content: "", base_dir: "C:/docs", image_paths: ["C:/docs/image.png"], encoding: "utf-8", modified_at: "", size_bytes: 0 };
}
function options(doc = document("C:/docs/a.md")): Parameters<typeof useDocumentWatchTargets>[0] {
  return { tabs: [{ document: doc }], autoReload: "on", windowLabel: "test-window" };
}
beforeEach(() => {
  mocks.read.mockImplementation(async (path: string) => [path, "C:/docs/linked.md"]);
  mocks.sync.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("ローカルの保存済み文書と画像・参照を重複なしで監視する", async () => {
  const props = options();
  props.tabs = [...props.tabs, { document: { ...document("spmd://contoso.sharepoint.com/sites/a/docs/a.md"), source: "sharepoint" } }, { document: document("untitled"), untitled: true }];
  renderHook(() => useDocumentWatchTargets(props));
  await waitFor(() => expect(mocks.sync).toHaveBeenLastCalledWith("test-window", ["C:/docs/a.md", "C:/docs/image.png", "C:/docs/linked.md"]));
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith("C:/docs/a.md");
});

it("通常更新OFFでも開いた差分だけを監視し、閉じたら解除する", async () => {
  const props = { ...options(), autoReload: "off" as const, diffPath: "C:/docs/diff.md" };
  const { rerender } = renderHook(useDocumentWatchTargets, { initialProps: props as Parameters<typeof useDocumentWatchTargets>[0] });
  await waitFor(() => expect(mocks.sync).toHaveBeenLastCalledWith("test-window", ["C:/docs/diff.md"]));
  rerender({ ...props, diffPath: undefined });
  expect(mocks.remove).toHaveBeenLastCalledWith("test-window");
});

it("文書を切り替えた後に届いた古い参照一覧を採用しない", async () => {
  let finish!: (paths: string[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise<string[]>(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(useDocumentWatchTargets, { initialProps: options() });
  rerender(options(document("C:/docs/b.md")));
  await waitFor(() => expect(result.current["C:/docs/b.md"]).toBeDefined());
  await act(async () => finish(["C:/docs/a.md", "C:/docs/obsolete.md"]));
  expect(result.current["C:/docs/a.md"]).toBeUndefined();
  expect(mocks.sync).toHaveBeenLastCalledWith("test-window", ["C:/docs/b.md", "C:/docs/image.png", "C:/docs/linked.md"]);
});

it("参照解析失敗時も本文と画像を監視し、次の保存revisionで再取得する", async () => {
  mocks.read.mockRejectedValueOnce(new Error("ファイル読込失敗"));
  const { result, rerender } = renderHook(useDocumentWatchTargets, { initialProps: options() });
  await act(async () => {});
  expect(result.current).toEqual({});
  expect(mocks.sync).toHaveBeenLastCalledWith("test-window", ["C:/docs/a.md", "C:/docs/image.png"]);
  rerender(options(document("C:/docs/a.md", "r2")));
  await waitFor(() => expect(result.current["C:/docs/a.md"]).toContain("C:/docs/linked.md"));
});

it("同じ文書の画面再描画では再解析せず、閉じたウィンドウへ後着結果を反映しない", async () => {
  let finish!: (paths: string[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise<string[]>(resolve => { finish = resolve; }));
  const { rerender, unmount } = renderHook(useDocumentWatchTargets, { initialProps: options() });
  rerender(options());
  expect(mocks.read).toHaveBeenCalledOnce();
  unmount();
  const syncCount = mocks.sync.mock.calls.length;
  await act(async () => finish(["late"]));
  expect(mocks.sync).toHaveBeenCalledTimes(syncCount);
  expect(mocks.remove).toHaveBeenLastCalledWith("test-window");
});
