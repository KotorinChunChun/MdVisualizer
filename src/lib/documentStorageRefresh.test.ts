import { describe, expect, it } from "vitest";
import { initialTabsState, tabsReducer, type TabsAction } from "../state/tabsReducer";
import type { MarkdownLoadResult } from "../types/app";
import { createDocumentStorageRefresh } from "./documentStorageRefresh";
import { documentDiffTarget } from "./documentDiffTarget";
import { buildWorkspaceDiffPanes } from "../components/DocumentDiffWorkspace";
import { documentDiffProtectsDraft } from "./documentDiffSave";

const doc = (content: string, revision = content): MarkdownLoadResult => ({
  path: "C:/docs/a.md", kind: "markdown", content, revision, base_dir: "C:/docs", image_paths: [],
  encoding: "UTF-8", size_bytes: content.length, modified_at: revision,
});
function setup() {
  let state = tabsReducer(initialTabsState, { type: "OPEN", path: "C:/docs/a.md" });
  const id = state.activeId!;
  const dispatch = (action: TabsAction) => { state = tabsReducer(state, action); };
  dispatch({ type: "LOADED", id, generation: 1, document: doc("base") });
  let autoReload = true;
  const requests: { resolve: (value: MarkdownLoadResult) => void; reject: (reason: unknown) => void }[] = [];
  const refresh = createDocumentStorageRefresh({ getTab: (tabId) => state.tabs.find((tab) => tab.id === tabId),
    load: () => new Promise<MarkdownLoadResult>((resolve, reject) => requests.push({ resolve, reject })),
    dispatch, shouldReload: () => autoReload });
  return { id, dispatch, refresh: (allowReload = true) => refresh(id, allowReload), requests,
    tab: () => state.tabs.find((tab) => tab.id === id)!, state: () => state,
    setAutoReload: (value: boolean) => { autoReload = value; } };
}

describe("ストレージ通知とDiff基準", () => {
  it("未編集なら本文・基準・リビジョン・メタデータを同時更新する", async () => {
    const s = setup(); const pending = s.refresh();
    s.requests[0].resolve({ ...doc("external", "r2"), encoding: "UTF-16LE" }); await pending;
    expect(s.tab()).toMatchObject({ openedContent: "external", draft: "external", dirty: false, externalChanged: false,
      document: { revision: "r2", encoding: "UTF-16LE" }, storageDocument: { revision: "r2" } });
    expect(buildWorkspaceDiffPanes(documentDiffTarget(s.tab()), "edit").mode).toBe("two-way");
  });
  it.each(["edit", "split", "preview"] as const)("%sのDiff中に外部更新すると3-wayへ変わり編集は残る", async (mode) => {
    const s = setup(); s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: "mine" });
    const initial = documentDiffTarget(s.tab());
    expect(buildWorkspaceDiffPanes(initial, mode).summary).toContain("2-way");
    const pending = s.refresh(); s.requests[0].resolve(doc("external")); await pending;
    expect(s.tab()).toMatchObject({ openedContent: "base", draft: "mine", document: { content: "base" }, externalChanged: true });
    expect(buildWorkspaceDiffPanes(documentDiffTarget(s.tab()), mode).mode).toBe("three-way");
  });
  it.each(["入力", "Undo", "添付"])("取得中の%sで自動置換を中止する", async (change) => {
    const s = setup(); const pending = s.refresh();
    if (change === "添付") s.dispatch({ type: "STAGED_ASSET_ADDED", id: s.id, content: "base", asset: { id: "asset", filename: "a.csv" } });
    else { s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: "typing" });
      if (change === "Undo") s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: "base" }); }
    s.requests[0].resolve(doc("external")); await pending;
    expect(s.tab().openedContent).toBe("base");
    expect(s.tab().draft).toBe(change === "入力" ? "typing" : "base");
    expect(s.tab().storageDocument?.content).toBe("external");
  });
  it("明示再読込でも読込中の入力は消さない", () => {
    const s = setup(); s.dispatch({ type: "RELOAD", id: s.id });
    s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: "typing" });
    s.dispatch({ type: "LOADED", id: s.id, generation: s.tab().generation, document: doc("external") });
    expect(s.tab()).toMatchObject({ draft: "typing", openedContent: "base", loading: false, storageDocument: { content: "external" } });
  });
  it("古い応答が後着しても最新状態を巻き戻さない", async () => {
    const s = setup(); const first = s.refresh(); const second = s.refresh();
    s.requests[1].resolve(doc("newest")); await second;
    s.requests[0].resolve(doc("old")); await first;
    expect(s.tab().draft).toBe("newest"); expect(s.tab().storageDocument?.content).toBe("newest");
  });
  it("OFF／手動相当ではDiff最新版のみ取得し本文は自動置換しない", async () => {
    const s = setup(); s.setAutoReload(false); const pending = s.refresh();
    s.requests[0].resolve(doc("external")); await pending;
    expect(s.tab()).toMatchObject({ draft: "base", openedContent: "base", externalChanged: true });
    expect(documentDiffTarget(s.tab()).storageContent).toBe("external");
  });
  it("Diff開始時は自動リロード設定と独立して比較だけを取得する", async () => {
    const s = setup(); const pending = s.refresh(false); s.requests[0].resolve(doc("external")); await pending;
    expect(s.tab().openedContent).toBe("base"); expect(s.tab().draft).toBe("base");
  });
  it("同じ本文でリビジョンだけ変わった場合も正常リロードで更新する", async () => {
    const s = setup(); const pending = s.refresh(); s.requests[0].resolve(doc("base", "r2")); await pending;
    expect(s.tab().document?.revision).toBe("r2");
    expect(buildWorkspaceDiffPanes(documentDiffTarget(s.tab()), "edit").mode).toBe("two-way");
  });
  it("保存成功で進めた基準を古い再読込応答が上書きしない", () => {
    const s = setup(); s.dispatch({ type: "RELOAD", id: s.id }); const generation = s.tab().generation;
    s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: "saved" });
    s.dispatch({ type: "SAVED", id: s.id, document: doc("saved") });
    s.dispatch({ type: "LOADED", id: s.id, generation, document: doc("old") });
    expect(s.tab().openedContent).toBe("saved"); expect(s.tab().draft).toBe("saved");
  });
  it("保存中の追加入力を残し、保存後の外部更新も検知する", async () => {
    const s = setup(); s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: "saved" });
    s.dispatch({ type: "SAVE_STARTED", id: s.id });
    s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: "saved plus typing" });
    s.dispatch({ type: "SAVED", id: s.id, document: doc("saved") });
    const pending = s.refresh(); s.requests[0].resolve(doc("external after save")); await pending;
    expect(s.tab()).toMatchObject({ openedContent: "saved", draft: "saved plus typing", dirty: true,
      storageDocument: { content: "external after save" } });
  });
  it.each(["権限不足", "削除"])("%sで基準もドラフトも破棄しない", async (reason) => {
    const s = setup(); const pending = s.refresh(); s.requests[0].reject(new Error(reason)); await pending;
    expect(s.tab()).toMatchObject({ openedContent: "base", draft: "base", externalChanged: true, storageRefreshing: false });
    expect(s.tab().storageError).toContain(reason);
  });
  it("削除通知後の古い読込応答は採用しない", async () => {
    const s = setup(); const pending = s.refresh();
    s.dispatch({ type: "STORAGE_UNAVAILABLE", id: s.id, error: "deleted" });
    s.requests[0].resolve(doc("old")); await pending;
    expect(s.tab().storageError).toBe("deleted"); expect(s.tab().draft).toBe("base");
  });
  it("閉じたタブの応答は別タブに適用しない", async () => {
    const s = setup(); const pending = s.refresh(); s.dispatch({ type: "CLOSE", id: s.id });
    s.dispatch({ type: "OPEN", path: "C:/docs/b.md" });
    s.requests[0].resolve(doc("external")); await pending;
    expect(s.state().tabs[0].path).toBe("C:/docs/b.md"); expect(s.state().tabs[0].document).toBeNull();
  });
  it("3wayで基準本文を残す判断をした後の重複通知でも、結果と基準を自動置換しない", async () => {
    const s = setup();
    s.dispatch({ type: "STORAGE_CONFLICT", id: s.id, document: doc("external", "r2") });
    const review = { path: s.tab().path, content: "base", baselineRevision: "base", storageRevision: "r2",
      hasExternalChanges: true, blocked: false, unresolved: 0 };
    const refresh = createDocumentStorageRefresh({ getTab: () => s.tab(), dispatch: s.dispatch,
      shouldReload: () => !documentDiffProtectsDraft(s.tab(), review), load: async () => doc("external", "r2") });
    await refresh(s.id);
    expect(s.tab()).toMatchObject({ openedContent: "base", draft: "base", dirty: false, storageDocument: { revision: "r2" } });
  });
});
