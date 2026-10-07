import { isTauri } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";

/**
 * Desktopの確認を公開APIへ接続する。
 * dialog 2.7.2の起動スクリプトは削除済みのconfirmコマンドを呼ぶため、
 * messageコマンドを利用する公開APIへ置き換える。呼出し側は結果をawaitする。
 * Web/SPFxの同期confirmは変更しない。
 */
export function installNativeConfirmation(): void {
  if (!isTauri()) return;
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: (message?: string) => confirm(String(message ?? "")),
  });
}
