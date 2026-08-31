import { describe, expect, it } from "vitest";
import { initialTabsState, tabsReducer } from "../state/tabsReducer";
import type { DiffSaveReview } from "../components/DocumentDiffWorkspace";
import { documentDiffProtectsDraft, documentDiffSavePermission } from "./documentDiffSave";

function fixture() {
  let state = tabsReducer(initialTabsState, { type: "NEW_MARKDOWN" });
  const document = { ...state.tabs[0].document!, path: "C:/a.md", content: "base", revision: "r1" };
  state = tabsReducer(state, { type: "DRAFT_CHANGED", id: state.activeId!, content: "base" });
  state = tabsReducer(state, { type: "SAVED", id: state.activeId!, document });
  state = tabsReducer(state, { type: "STORAGE_CONFLICT", id: state.activeId!, document: { ...document, content: "storage", revision: "r2" } });
  const tab = state.tabs[0];
  const review: DiffSaveReview = { path: tab.path, content: tab.draft, baselineRevision: "r1", storageRevision: "r2", unresolved: 0, blocked: false, hasExternalChanges: true };
  return { tab, review };
}
describe("Diffの全保存入口の保護", () => {
  it("基準と同じ内容を選びdirtyが消えても、3way判断中の自動再読込から保護する", () => {
    const { tab, review } = fixture();
    expect(tab.dirty).toBe(false);
    expect(documentDiffProtectsDraft(tab, review)).toBe(true);
    expect(documentDiffProtectsDraft(tab, { ...review, hasExternalChanges: false })).toBe(false);
    expect(documentDiffProtectsDraft(tab, { ...review, path: "C:/other.md" })).toBe(false);
    expect(documentDiffProtectsDraft(tab, null)).toBe(false);
  });
  it("採用を確定した最新リビジョンへだけ保存する", () => {
    const { tab, review } = fixture(); expect(documentDiffSavePermission(tab, review)).toEqual({ expectedRevision: "r2", force: true });
  });
  it.each([
    { unresolved: 1 }, { blocked: true }, { content: "old" }, { baselineRevision: "old" }, { storageRevision: "old" },
  ])("未選択・取得中・古いレビューを拒否する: %j", (patch) => {
    const { tab, review } = fixture(); expect(documentDiffSavePermission(tab, { ...review, ...patch }).error).toBeTruthy();
  });
  it("レビュー直後に新版が到着した場合も旧判断で保存しない", () => {
    const { tab, review } = fixture();
    expect(documentDiffSavePermission({ ...tab, storageDocument: { ...tab.storageDocument!, revision: "r3" } }, review).error).toBeTruthy();
  });
  it("他タブやDiffを閉じた後は、未確認の最新版リビジョンを流用しない", () => {
    const { tab, review } = fixture();
    expect(documentDiffSavePermission(tab, null).expectedRevision).toBe("r1");
    expect(documentDiffSavePermission(tab, { ...review, path: "C:/other.md" }).expectedRevision).toBe("r1");
  });
});
