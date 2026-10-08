import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSharePointAuthentication } from "./useSharePointAuthentication";
const mocks = vi.hoisted(() => ({ listen: vi.fn(), open: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/sharePoint", () => ({ listenForSharePointAuthentication: mocks.listen }));
vi.mock("../lib/commands", () => ({ openExternalUrl: mocks.open }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("認証イベントの登録が完了するまで読込準備完了にしない", async () => {
  let finish!: (value: () => void) => void;
  mocks.listen.mockReturnValue(new Promise<() => void>(resolve => { finish = resolve; }));
  const toast = vi.fn();
  const { result } = renderHook(() => useSharePointAuthentication(toast));
  expect(result.current.authenticationReady).toBe(false);
  await act(async () => finish(vi.fn()));
  expect(result.current.authenticationReady).toBe(true);
});
it("登録前に閉じた画面の遅延登録は即解除し、イベントからブラウザーを開かない", async () => {
  let finish!: (value: () => void) => void;
  mocks.listen.mockReturnValue(new Promise<() => void>(resolve => { finish = resolve; }));
  const { unmount } = renderHook(() => useSharePointAuthentication(vi.fn()));
  const callback = mocks.listen.mock.calls[0][0];
  unmount();
  const dispose = vi.fn();
  await act(async () => finish(dispose));
  callback({ payload: { verificationUri: "https://microsoft.com/devicelogin" } });
  expect(dispose).toHaveBeenCalledOnce();
  expect(mocks.open).not.toHaveBeenCalled();
});
it("登録失敗を読込可能とせず明示エラーにする", async () => {
  mocks.listen.mockRejectedValue(new Error("listen failed"));
  const toast = vi.fn();
  const { result } = renderHook(() => useSharePointAuthentication(toast));
  await waitFor(() => expect(result.current.authenticationError).toContain("認証案内の準備に失敗"));
  expect(result.current.authenticationReady).toBe(false);
});
