import type { TabState } from "../state/tabsReducer";

export interface DocumentDiffTarget {
  path: string;
  baseDir: string;
  openedContent: string;
  storageContent: string;
  editingContent: string;
  baselineRevision?: string;
  storageRevision?: string;
  conflict?: boolean;
  refreshing?: boolean;
  storageError?: string | null;
}

/** Diff用の本文を別stateに複製せず、タブの確定基準と最新版から導出する。 */
export function documentDiffTarget(tab: TabState, conflict = false): DocumentDiffTarget {
  if (!tab.document) throw new Error("読込済み文書がありません。");
  const storage = tab.storageDocument ?? tab.document;
  return { path: tab.document.path, baseDir: tab.document.base_dir,
    openedContent: tab.openedContent ?? tab.document.content, storageContent: storage.content, editingContent: tab.draft,
    baselineRevision: tab.document.revision, storageRevision: storage.revision, conflict,
    refreshing: tab.storageRefreshing, storageError: tab.storageError };
}
