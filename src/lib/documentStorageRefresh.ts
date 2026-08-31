import type { TabState, TabsAction } from "../state/tabsReducer";
import type { MarkdownLoadResult } from "../types/app";

/** ファイル通知とDiff開始時の取得を共通化する。応答の採否はタブの世代で判定する。 */
export function createDocumentStorageRefresh({ getTab, load, dispatch, shouldReload }: {
  getTab: (id: string) => TabState | undefined;
  load: (path: string) => Promise<MarkdownLoadResult>;
  dispatch: (action: TabsAction) => void;
  shouldReload: (id: string) => boolean;
}) {
  let request = 0;
  return async (id: string, allowReload = true): Promise<void> => {
    const tab = getTab(id);
    if (!tab?.document || tab.untitled) return;
    const token = ++request;
    const generation = tab.generation;
    const changeSequence = tab.changeSequence ?? 0;
    dispatch({ type: "STORAGE_REQUESTED", id, request: token });
    try {
      const document = await load(tab.document.path);
      dispatch({ type: "STORAGE_LOADED", id, request: token, generation, changeSequence,
        reloadIfClean: allowReload && shouldReload(id), document });
    } catch (error) {
      dispatch({ type: "STORAGE_FAILED", id, request: token, generation, error: String(error) });
    }
  };
}
