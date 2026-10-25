import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), dispose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
import { canStopFromHost, connectManagement } from "./management";

beforeEach(() => { vi.clearAllMocks(); mocks.listen.mockResolvedValue(mocks.dispose); mocks.invoke.mockResolvedValue(undefined); });
describe("本体からの終了保護", () => {
  it("全タブの未保存・保存中・読込中と編集画面を保護する", () => {
    const clean = { dirty: false, saving: false, loading: false };
    expect(canStopFromHost([clean], false)).toBe(true);
    for (const key of ["dirty", "saving", "loading"]) expect(canStopFromHost([clean, { ...clean, [key]: true }], false)).toBe(false);
    expect(canStopFromHost([], true)).toBe(false);
  });
  it("受信ごとに最新状態で回答し、受信準備後にreadyを通知する", async () => {
    let allowed = true;
    const dispose = await connectManagement(() => allowed);
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
    const handler = mocks.listen.mock.calls[0][1];
    handler({ payload: "one" }); allowed = false; handler({ payload: "two" });
    expect(mocks.invoke).toHaveBeenCalledWith("management_stop_reply", { id: "one", allowed: true });
    expect(mocks.invoke).toHaveBeenCalledWith("management_stop_reply", { id: "two", allowed: false });
    dispose(); expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("準備失敗時に受信を解放する", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("not available"));
    await expect(connectManagement(() => true)).rejects.toThrow("not available");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
