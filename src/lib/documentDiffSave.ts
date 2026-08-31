import type { DiffSaveReview } from "../components/DocumentDiffWorkspace";
import type { TabState } from "../state/tabsReducer";
import { documentSourceIdentity } from "./pathIdentity";

/** UIのボタン状態だけに頼らず、Ctrl+S等の全保存入口でレビュー対象の版を検証する。 */
export function documentDiffSavePermission(tab: TabState, review: DiffSaveReview | null): { error?: string; expectedRevision: string; force: boolean } {
  const baseline = tab.document?.revision ?? "";
  if (!review || documentSourceIdentity(review.path) !== documentSourceIdentity(tab.path)) return { expectedRevision: baseline, force: false };
  const storage = tab.storageDocument ?? tab.document;
  if (review.blocked || tab.storageRefreshing || tab.storageError) return { error: "ストレージ最新版の確認が完了していません。", expectedRevision: baseline, force: false };
  if (review.content !== tab.draft || review.baselineRevision !== baseline || review.storageRevision !== storage?.revision) {
    return { error: "比較対象が更新されました。最新の差分を確認してから保存してください。", expectedRevision: baseline, force: false };
  }
  if (review.unresolved > 0) return { error: `未選択の外部変更が${review.unresolved}行あります。両側の矢印で確認してください。`, expectedRevision: baseline, force: false };
  return { expectedRevision: storage?.revision ?? baseline, force: review.hasExternalChanges };
}
