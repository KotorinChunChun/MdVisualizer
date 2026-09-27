/** 削除済みファイルだけを定期確認する。読み込み中は重複させず、既存の世代判定を利用する。 */
export function startDeletedDocumentRecovery(
  getTargets: () => Array<{ id: string; deleted?: boolean; untitled?: boolean; storageRefreshing?: boolean; local: boolean }>,
  refresh: (id: string) => Promise<void>,
  intervalMs = 2000,
): () => void {
  const pending = new Set<string>();
  const timer = setInterval(() => {
    for (const tab of getTargets()) {
      if (!tab.deleted || tab.untitled || !tab.local || tab.storageRefreshing || pending.has(tab.id)) continue;
      pending.add(tab.id);
      void refresh(tab.id).catch(() => {}).finally(() => pending.delete(tab.id));
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
