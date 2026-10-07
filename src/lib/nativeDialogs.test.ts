import { afterEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { installNativeConfirmation } from "./nativeDialogs";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
const original = Object.getOwnPropertyDescriptor(window, "confirm")!;
afterEach(() => { Object.defineProperty(window, "confirm", original); vi.resetAllMocks(); });

describe("デスクトップの実APIへ確認を接続する", () => {
  it("Webの標準確認を保持する", () => {
    const browserConfirm = window.confirm;
    vi.mocked(isTauri).mockReturnValue(false);
    installNativeConfirmation();
    expect(window.confirm).toBe(browserConfirm);
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each([false, true])("APIの選択結果 %s をそのまま待つ", async answer => {
    vi.mocked(isTauri).mockReturnValue(true);
    let resolve!: (answer: boolean) => void;
    vi.mocked(confirm).mockReturnValue(new Promise(done => { resolve = done; }));
    installNativeConfirmation();
    const result = window.confirm("未保存の編集を破棄しますか？");
    expect(result).toBeInstanceOf(Promise);
    expect(confirm).toHaveBeenCalledExactlyOnceWith("未保存の編集を破棄しますか？");
    resolve(answer);
    expect(await result).toBe(answer);
  });
  it("確認エラーを承認へ変えず呼出し側へ返す", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(confirm).mockRejectedValue(new Error("確認失敗"));
    installNativeConfirmation();
    await expect(window.confirm("確認")).rejects.toThrow("確認失敗");
  });
});
