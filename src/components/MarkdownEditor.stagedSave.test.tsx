import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef, useReducer } from "react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import { TabBar } from "./TabBar";
import { initialTabsState, tabsReducer, type TabsAction, type TabsState } from "../state/tabsReducer";
import { referencedStagedAssetIds } from "../lib/clipboardImage";
import { collectEditableMarkdownOccurrences } from "../lib/markdownOccurrences";
import { imageOccurrenceWithSource } from "../lib/assetConversion";
import { planOccurrenceConversion } from "../lib/immediateMarkdownMutation";
import { createDocumentStorageRefresh } from "../lib/documentStorageRefresh";
import type { MarkdownLoadResult, StagedDocumentAsset } from "../types/app";

vi.mock("../features/codex/skills", () => ({
  useCodexSkills: () => [], visibleSkills: (skills: unknown[]) => skills,
}));
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const original = "# 保存済み本文\n";
const embedded = `${original}\n![未確定](${png})\n\n保存前の追記\n`;
const imageAsset: StagedDocumentAsset = { id: "stage-png", filename: "未確定.png", mediaType: "image/png", base64: png.split(",")[1], previewSource: png };
const image = (content: string) => {
  const value = collectEditableMarkdownOccurrences(content).find(item => item.kind === "image");
  if (value?.kind !== "image") throw new Error("試験用の画像出現が必要");
  return value;
};
const doc = (content: string): MarkdownLoadResult => ({
  path: "C:/fixture/M08.md", kind: "markdown", content, base_dir: "C:/fixture", image_paths: [],
  encoding: "UTF-8", size_bytes: content.length, modified_at: "2026-10-08", revision: `rev:${content}`,
});
function loaded(content = original) {
  const state = tabsReducer(initialTabsState, { type: "OPEN", path: doc(content).path });
  return tabsReducer(state, { type: "LOADED", id: state.activeId!, generation: 1, document: doc(content) });
}
type WithoutTabId<Action> = Action extends { id: string } ? Omit<Action, "id"> : never;
type TabAction = WithoutTabId<TabsAction>;
function send(state: TabsState, action: TabAction) {
  return tabsReducer(state, { ...action, id: state.activeId! });
}
function roundtrip() {
  let state = loaded();
  state = send(state, { type: "DRAFT_CHANGED", content: embedded });
  const occurrence = image(embedded);
  const filed = planOccurrenceConversion(original, embedded, occurrence, imageOccurrenceWithSource(occurrence, imageAsset.filename)).draft;
  state = send(state, { type: "STAGED_ASSET_ADDED", content: filed, asset: imageAsset });
  const restored = planOccurrenceConversion(original, filed, image(filed), imageOccurrenceWithSource(image(filed), imageAsset.previewSource!)).draft;
  expect(restored).toBe(embedded);
  state = send(state, { type: "DRAFT_CHANGED", content: restored });
  return { state, filed };
}
function save(state: TabsState, content = state.tabs[0].draft) {
  const assets = referencedStagedAssetIds(content, doc(content).base_dir, state.tabs[0].pendingAssets ?? []);
  return { state: send(state, { type: "SAVED", document: doc(content), committedAssetIds: assets }), assets };
}

describe("B02-M08追補: 保存対象のstage参照と未保存状態", () => {
  it("埋込→未保存ファイル→埋込を保存すると参照しないstageだけでdirtyにならない", () => {
    const prepared = roundtrip();
    const result = save(prepared.state);
    expect(result.assets).toEqual([]);
    expect(result.state.tabs[0]).toMatchObject({ draft: embedded, document: { content: embedded }, dirty: false, saving: false });
    // 保存後Undoで未作成PNGへ戻せるよう、未commitの内容はタブの履歴と共に保持する。
    expect(result.state.tabs[0].pendingAssets).toEqual([imageAsset]);
  });

  it("保存済み埋込へ戻すUndo・Redoでも参照の有無でdirtyを切り替える", () => {
    let state = loaded(embedded);
    const occurrence = image(embedded);
    const filed = imageOccurrenceWithSource(occurrence, imageAsset.filename);
    state = send(state, { type: "STAGED_ASSET_ADDED", content: filed, asset: imageAsset });
    expect(state.tabs[0].dirty).toBe(true);
    state = send(state, { type: "DRAFT_CHANGED", content: embedded });
    expect(state.tabs[0].dirty).toBe(false);
    expect(state.tabs[0].pendingAssets).toEqual([imageAsset]);
    state = send(state, { type: "DRAFT_CHANGED", content: filed });
    expect(state.tabs[0].dirty).toBe(true);
    expect(referencedStagedAssetIds(state.tabs[0].draft, "C:/fixture", state.tabs[0].pendingAssets!)).toEqual([imageAsset.id]);
  });

  it("保存応答待ちにファイル参照へ戻したstageは保持し、次の保存だけでcommitする", () => {
    const prepared = roundtrip();
    let state = send(prepared.state, { type: "SAVE_STARTED" });
    state = send(state, { type: "DRAFT_CHANGED", content: prepared.filed });
    const first = save(state, embedded);
    expect(first.assets).toEqual([]);
    expect(first.state.tabs[0]).toMatchObject({ draft: prepared.filed, document: { content: embedded }, dirty: true, pendingAssets: [imageAsset] });
    const second = save(first.state);
    expect(second.assets).toEqual([imageAsset.id]);
    expect(second.state.tabs[0]).toMatchObject({ dirty: false, pendingAssets: [] });
  });

  it("保存失敗ではstageと本文を保全し、成功した再保存時にcleanになる", () => {
    const prepared = roundtrip();
    let state = send(prepared.state, { type: "SAVE_STARTED" });
    state = send(state, { type: "SAVE_FAILED", error: "試験用保存失敗" });
    expect(state.tabs[0]).toMatchObject({ draft: embedded, document: { content: original }, dirty: true, pendingAssets: [imageAsset] });
    expect(save(state).state.tabs[0]).toMatchObject({ dirty: false, saveError: null, pendingAssets: [imageAsset] });
  });

  it("別の保存済み出現を即時変換しても未参照stageをdirtyへ数えない", () => {
    const prepared = roundtrip();
    const state = send(prepared.state, { type: "IMMEDIATE_SAVED", document: doc(embedded), draft: embedded, openedContent: embedded, committedAssetIds: [] });
    expect(state.tabs[0]).toMatchObject({ dirty: false, pendingAssets: [imageAsset] });
  });

  it("stageを一つ取り消したとき残る未参照stageだけではdirtyにしない", () => {
    let state = loaded(embedded);
    state = send(state, { type: "STAGED_ASSET_ADDED", content: "![一つ目](未確定.png)", asset: imageAsset });
    state = send(state, { type: "STAGED_ASSET_ADDED", content: "![二つ目](second.png)", asset: { ...imageAsset, id: "second", filename: "second.png" } });
    state = send(state, { type: "STAGED_ASSET_REMOVED", content: embedded, stagingId: "second" });
    expect(state.tabs[0]).toMatchObject({ dirty: false, pendingAssets: [imageAsset] });
  });

  it("未参照のtext stage更新はdirtyにせず、参照が同じ外部本文の更新はdirtyにする", () => {
    const textAsset = { id: "table", filename: "table.tsv", text: "A\n1" };
    let state = loaded(embedded);
    state = send(state, { type: "STAGED_ASSET_ADDED", content: "![表](table.tsv)", asset: textAsset });
    state = send(state, { type: "DRAFT_CHANGED", content: embedded });
    state = send(state, { type: "STAGED_ASSET_UPDATED", stagingId: textAsset.id, text: "A\n2" });
    expect(state.tabs[0].dirty).toBe(false);
    expect(state.tabs[0].pendingAssets?.[0].text).toBe("A\n2");
    let referenced = loaded("![表](table.tsv)");
    referenced = send(referenced, { type: "STAGED_ASSET_ADDED", content: "![表](table.tsv)", asset: textAsset });
    referenced = send(referenced, { type: "STAGED_ASSET_UPDATED", stagingId: textAsset.id, text: "A\n2" });
    expect(referenced.tabs[0].dirty).toBe(true);
    expect(save(referenced).assets).toEqual([textAsset.id]);
  });

  it.each(["revision", "本文"])("外部の%sが変わる通知は従来どおり履歴世代と添付状態をリセットする", changed => {
    let state = save(roundtrip().state).state;
    const before = state.tabs[0];
    const document = changed === "revision" ? { ...doc(embedded), revision: "external-revision" } : { ...doc("外部本文"), revision: before.document!.revision };
    state = send(state, { type: "STORAGE_REQUESTED", request: 10 });
    state = send(state, { type: "STORAGE_LOADED", request: 10, generation: before.generation, changeSequence: before.changeSequence ?? 0, reloadIfClean: true, document });
    expect(state.tabs[0]).toMatchObject({ draft: document.content, editorResetSequence: (before.editorResetSequence ?? 0) + 1, pendingAssets: [], dirty: false });
  });

  it.each([false, true])("実Editorで保存後の重複通知=%sをまたいでUndoの画像参照とstageを復元しRedoでcleanに戻る", async repeatedNotification => {
    const ref = createRef<MarkdownEditorHandle>();
    const initial = loaded();
    const controls = { state: initial, dispatch: (_action: TabsAction) => {} };
    function Host() {
      const [state, dispatch] = useReducer(tabsReducer, initial);
      controls.state = state; controls.dispatch = dispatch;
      const tab = state.tabs[0];
      return <>
        <TabBar tabs={state.tabs} activeId={state.activeId} onActivate={() => {}} onClose={() => {}} onMove={() => {}} onContext={() => {}} />
        <button disabled={!tab.dirty || tab.saving}>試験保存</button>
        <MarkdownEditor ref={ref} documentId={`${tab.id}:${tab.generation}`} historyKey={`${tab.id}:${tab.editorResetSequence ?? 0}`} value={tab.draft} dirty={tab.dirty} saving={tab.saving}
          stagedAssetPreviews={Object.fromEntries((tab.pendingAssets ?? []).map(asset => [asset.filename, asset.previewSource!]))}
          onChange={content => dispatch({ type: "DRAFT_CHANGED", id: tab.id, content })} onSave={() => {}} />
      </>;
    }
    const mounted = render(<Host />);
    const dispatch = (action: TabAction) => act(() => controls.dispatch({ ...action, id: initial.activeId! }));
    const occurrence = image(embedded);
    const filed = planOccurrenceConversion(original, embedded, occurrence, imageOccurrenceWithSource(occurrence, imageAsset.filename)).draft;
    dispatch({ type: "DRAFT_CHANGED", content: embedded });
    dispatch({ type: "STAGED_ASSET_ADDED", content: filed, asset: imageAsset });
    dispatch({ type: "DRAFT_CHANGED", content: embedded });
    dispatch({ type: "SAVE_STARTED" });
    dispatch({ type: "SAVED", document: doc(embedded), committedAssetIds: [] });
    if (repeatedNotification) {
      // 実Appの自動再読込ON＋保存後ファイル監視通知。保存応答と同じ内容／revisionでも届く。
      const refresh = createDocumentStorageRefresh({
        getTab: id => controls.state.tabs.find(tab => tab.id === id), load: async () => ({ ...doc(embedded), modified_at: "2026-10-08 05:06" }),
        dispatch: action => controls.dispatch(action), shouldReload: () => true,
      });
      const historySequence = controls.state.tabs[0].editorResetSequence;
      await act(async () => { await refresh(initial.activeId!); });
      await act(async () => { await refresh(initial.activeId!); });
      expect(controls.state.tabs[0]).toMatchObject({ editorResetSequence: historySequence, pendingAssets: [imageAsset], document: { modified_at: "2026-10-08 05:06" } });
    }
    expect(screen.getByRole("button", { name: "試験保存" }).hasAttribute("disabled")).toBe(true);
    expect(mounted.container.querySelector(".tab__label")?.textContent).not.toContain(" *");
    let undone = false;
    act(() => { undone = ref.current!.undo(); });
    expect(undone).toBe(true);
    const view = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(view.state.sliceDoc()).toBe(filed);
    expect(controls.state.tabs[0]).toMatchObject({ dirty: true, pendingAssets: [imageAsset] });
    expect(referencedStagedAssetIds(view.state.sliceDoc(), "C:/fixture", controls.state.tabs[0].pendingAssets!)).toEqual([imageAsset.id]);
    act(() => { expect(ref.current!.undo(true)).toBe(true); });
    expect(view.state.sliceDoc()).toBe(embedded);
    expect(controls.state.tabs[0].dirty).toBe(false);
    expect(screen.getByRole("button", { name: "試験保存" }).hasAttribute("disabled")).toBe(true);
    expect(mounted.container.querySelector(".tab__label")?.textContent).not.toContain(" *");
  });
});
