import type { TabState } from "../state/tabsReducer";

export async function handleWindowCloseRequest(
  hasUnsavedChanges: boolean,
  confirmDiscard: (message?: string) => boolean | Promise<boolean>,
  event: { preventDefault: () => void },
  destroyWindow: () => Promise<void>,
  isCurrent: () => boolean = () => true,
) {
  event.preventDefault();
  if (hasUnsavedChanges && await confirmDiscard("未保存の編集内容があります。破棄してアプリを終了しますか？") !== true) return;
  if (!isCurrent()) return;
  await destroyWindow();
}

/** 非同期確認が対象にした本文・保存世代を比較する。focusやscrollだけの変更は許容する。 */
export function unchangedTabForAction(before: TabState, current: TabState | undefined): boolean {
  return Boolean(current && current.id === before.id && current.path === before.path
    && current.generation === before.generation && current.changeSequence === before.changeSequence
    && current.draft === before.draft && current.dirty === before.dirty && current.saving === before.saving
    && current.loading === before.loading && current.pendingAssets === before.pendingAssets
    && current.document?.revision === before.document?.revision);
}

export async function confirmUnchangedTabAction(
  before: TabState,
  getCurrent: () => TabState | undefined,
  message: string,
  confirmAction: (message?: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  // Tauriのwindow.confirmはPromiseを返す。truthy判定では取消でも破棄してしまう。
  if (await confirmAction(message) !== true) return false;
  return unchangedTabForAction(before, getCurrent());
}

export async function closeTabsSequentially(ids: readonly string[], close: (id: string) => Promise<boolean>): Promise<boolean> {
  for (const id of ids) if (!await close(id)) return false;
  return true;
}
