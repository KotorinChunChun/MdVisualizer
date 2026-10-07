import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useEffect, useReducer, type ComponentProps } from "react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorHistoryStore } from "./MarkdownEditor";
import { TabBar } from "./TabBar";
import { initialTabsState, tabsReducer, type TabsAction } from "../state/tabsReducer";
import type { MarkdownLoadResult, StagedDocumentAsset } from "../types/app";
import type { ResolvedClipboardImage } from "../lib/clipboardImage";
import fixtures from "../../tests/fixtures/editor-natural-cycle03.json";

vi.mock("../features/codex/skills", () => ({
  useCodexSkills: () => [], visibleSkills: (skills: unknown[]) => skills,
}));
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type EditorProps = ComponentProps<typeof MarkdownEditor>;
type SaveReply = string | { cancelled: true } | void;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function body(view: EditorView) { return view.state.sliceDoc(); }
function selection(view: EditorView) {
  const { anchor, head } = view.state.selection.main;
  return { anchor, head };
}
function select(view: EditorView, anchor: number, head = anchor) {
  act(() => { view.dispatch({ selection: { anchor, head } }); view.focus(); });
}
// jsdomの通常入力だけ公開APIで再現する。focusをここで修復しない。
function type(view: EditorView, content: string) {
  expect(document.activeElement).toBe(view.contentDOM);
  act(() => view.dispatch(view.state.replaceSelection(content), { userEvent: "input.type" }));
}
function undo(ref: { current: MarkdownEditorHandle | null }, replay = false) {
  act(() => { expect(ref.current!.undo(replay)).toBe(true); });
}
function record(stage: string, view: EditorView, extra: unknown = {}) {
  console.info(JSON.stringify({ stage, body: body(view), selection: selection(view), focused: document.activeElement === view.contentDOM, extra }));
}
const asset = (id: string): StagedDocumentAsset => ({ id, filename: `images/${id}.png`, mediaType: "image/png", base64: fixtures.pngBase64 });
const png = () => new File([Uint8Array.from(atob(fixtures.pngBase64), char => char.charCodeAt(0))], "fixture.png", { type: "image/png" });
function paste(view: EditorView) {
  fireEvent.paste(view.contentDOM, { clipboardData: { files: [png()], items: [], getData: () => "" } });
}

function mount(value: string, props: Partial<EditorProps>) {
  const ref = createRef<MarkdownEditorHandle>(), onChange = vi.fn();
  const result = render(<MarkdownEditor ref={ref} documentId="B03-E03:1" value={value} dirty={false} saving={false} onChange={onChange} onSave={() => {}} {...props} />);
  return { ref, onChange, view: () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)! };
}

// 実Editor・TabBar・reducerを接続する。本文読込と保存だけをメモリーI/Oへ置換し、
// Appのダイアログ、OS入力、Tauri保存を検証済みとは扱わない。
function host(id: "E04" | "E10", props: Partial<EditorProps> = {}) {
  const input = fixtures[id], paths = { a: `C:/tests/B03-${id}/a.md`, b: `C:/tests/B03-${id}/b.md` };
  const disk = new Map([[paths.a, input.a], [paths.b, input.b]]);
  const documentFor = (path: string, content: string): MarkdownLoadResult => ({
    path, content, kind: "markdown", base_dir: path.slice(0, path.lastIndexOf("/")), image_paths: [],
    encoding: "UTF-8", size_bytes: content.length, modified_at: "2026-10-08", revision: `revision:${content}`,
  });
  let initial = initialTabsState;
  for (const path of Object.values(paths)) {
    initial = tabsReducer(initial, { type: "OPEN", path });
    const tab = initial.tabs.find(candidate => candidate.path === path)!;
    initial = tabsReducer(initial, { type: "LOADED", id: tab.id, generation: tab.generation, document: documentFor(path, disk.get(path)!) });
  }
  initial = tabsReducer(initial, { type: "ACTIVATE", id: initial.tabs[0].id });
  const ref = createRef<MarkdownEditorHandle>(), histories: MarkdownEditorHistoryStore = new Map();
  const control = { state: initial, dispatch: (_action: TabsAction) => {} };
  const writes: Array<{ id: string; path: string; content: string; pending: ReturnType<typeof deferred<SaveReply>> }> = [];
  const abandoned = vi.fn(), errors = vi.fn();
  function Host() {
    const [state, dispatch] = useReducer(tabsReducer, initial);
    const active = state.tabs.find(tab => tab.id === state.activeId)!;
    control.state = state; control.dispatch = dispatch;
    const keys = state.tabs.map(tab => `${tab.id}:${tab.editorResetSequence ?? 0}`).join("\0");
    useEffect(() => {
      const alive = new Set(keys.split("\0"));
      for (const key of histories.keys()) if (!alive.has(key)) histories.delete(key);
    }, [keys]);
    const save = async () => {
      if (!active.dirty || active.saving) return;
      const request = { id: active.id, path: active.path, content: active.draft, pending: deferred<SaveReply>() };
      writes.push(request);
      dispatch({ type: "SAVE_STARTED", id: active.id });
      const error = await request.pending.promise;
      if (typeof error === "object") { dispatch({ type: "SAVE_CANCELLED", id: request.id }); return; }
      if (error) { dispatch({ type: "SAVE_FAILED", id: request.id, error }); return; }
      disk.set(request.path, request.content);
      dispatch({ type: "SAVED", id: request.id, document: documentFor(request.path, request.content) });
    };
    return <>
      <TabBar tabs={state.tabs} activeId={state.activeId} onActivate={tabId => dispatch({ type: "ACTIVATE", id: tabId })}
        onClose={tabId => dispatch({ type: "CLOSE", id: tabId })} onMove={(tabId, toIndex) => dispatch({ type: "MOVE", id: tabId, toIndex })} onContext={() => {}} />
      <button onClick={() => {
        dispatch({ type: "OPEN", path: paths.a });
      }}>試験ホストでAを再選択</button>
      <button onClick={() => { void save(); }}>試験ホストの保存</button>
      {active?.document && <MarkdownEditor ref={ref} documentId={`${active.id}:${active.generation}`}
        historyKey={`${active.id}:${active.editorResetSequence ?? 0}`} historyStore={histories} documentPath={active.path}
        baseDir={active.document.base_dir} viewStateKey={active.path} value={active.draft} dirty={active.dirty} saving={active.saving}
        onChange={content => dispatch({ type: "DRAFT_CHANGED", id: active.id, content })} onSave={() => { void save(); }}
        onStagedAssetAdded={(content, staged) => dispatch({ type: "STAGED_ASSET_ADDED", id: active.id, content, asset: staged })}
        onStagedAssetAbandoned={abandoned} onPasteImageError={errors} {...props} />}
    </>;
  }
  const result = render(<Host />);
  const tab = (key: "a" | "b") => control.state.tabs.find(candidate => candidate.path === paths[key])!;
  const view = () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)!;
  const finishOpen = () => act(() => {
    const pending = tab("a");
    control.dispatch({ type: "LOADED", id: pending.id, generation: pending.generation, document: documentFor(paths.a, disk.get(paths.a)!) });
  });
  const save = () => fireEvent.keyDown(view().contentDOM, { key: "s", ctrlKey: true });
  const resolveSave = async (index: number, reply?: SaveReply) => { await act(async () => writes[index].pending.resolve(reply)); };
  return { ref, view, tab, paths, control, disk, writes, abandoned, errors, finishOpen, save, resolveSave };
}

describe("第3組候補 非同期処理と文書所有者のbefore", () => {
  it("B03-E03 2画像貼付の逆順応答で古い要求を解放し最新本文を保護して再試行", async () => {
    const first = deferred<ResolvedClipboardImage>(), second = deferred<ResolvedClipboardImage>();
    const resolver = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce({ source: "images/E03-retry.png", asset: asset("E03-retry") });
    const added = vi.fn(), abandoned = vi.fn(), errors = vi.fn();
    const original = fixtures.E03;
    const t = mount(original, { onResolvePastedImage: resolver, onStagedAssetAdded: added, onStagedAssetAbandoned: abandoned, onPasteImageError: errors });
    select(t.view(), 2, 6); paste(t.view());
    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    select(t.view(), original.length); paste(t.view());
    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));
    const accepted = asset("E03-second"), stale = asset("E03-first");
    await act(async () => second.resolve({ source: accepted.filename, asset: accepted }));
    const secondBody = original + "![](images/E03-second.png)", secondSelection = selection(t.view());
    expect(body(t.view())).toBe(secondBody);
    await act(async () => first.resolve({ source: stale.filename, asset: stale }));
    record("E03:逆順応答完了", t.view(), { adopted: added.mock.calls, abandoned: abandoned.mock.calls });
    expect(body(t.view())).toBe(secondBody); expect(selection(t.view())).toEqual(secondSelection);
    expect(added).toHaveBeenCalledExactlyOnceWith(secondBody, accepted);
    expect(abandoned).toHaveBeenCalledExactlyOnceWith(stale); expect(errors).toHaveBeenCalledOnce();
    select(t.view(), 2, 6); paste(t.view());
    await waitFor(() => expect(added).toHaveBeenCalledTimes(2));
    expect(body(t.view())).toBe("前\n![](images/E03-retry.png)\n後![](images/E03-second.png)");
    undo(t.ref); expect(body(t.view())).toBe(secondBody);
    undo(t.ref); expect(body(t.view())).toBe(original);
    expect(abandoned).toHaveBeenCalledTimes(1);
  });

  it("B03-E04 添付待ちの所有タブを閉じて再開しても古い応答は新タブへ混入しない", async () => {
    const pending = deferred<ResolvedClipboardImage>();
    const resolver = vi.fn().mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ source: "images/E04-retry.png", asset: asset("E04-retry") });
    const t = host("E04", { onResolveFileAttachment: resolver });
    const originalId = t.tab("a").id;
    select(t.view(), 2, 4); fireEvent.drop(t.view().contentDOM, { dataTransfer: { files: [png()] } });
    expect(resolver).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "a.md を閉じる" }));
    expect(t.control.state.tabs).toHaveLength(1);
    select(t.view(), fixtures.E04.b.length); type(t.view(), " B追記");
    const bSnapshot = { ...t.tab("b") }, bSelection = selection(t.view());
    // 古い応答が来る前に同じパスを再開し、パス一致だけでは採用しない境界を通す。
    fireEvent.click(screen.getByRole("button", { name: "試験ホストでAを再選択" })); t.finishOpen();
    expect(t.tab("a").id).not.toBe(originalId);
    const freshSnapshot = { ...t.tab("a") }, freshSelection = selection(t.view()), stale = asset("E04-closed");
    await act(async () => pending.resolve({ source: stale.filename, asset: stale }));
    record("E04:閉鎖前要求の後着", t.view());
    expect(t.tab("a")).toEqual(freshSnapshot); expect(selection(t.view())).toEqual(freshSelection);
    expect(t.tab("b")).toEqual(bSnapshot); expect(body(t.view())).toBe(fixtures.E04.a);
    expect(t.abandoned).toHaveBeenCalledExactlyOnceWith(stale); expect(t.errors).toHaveBeenCalledOnce();
    select(t.view(), 2, 4); fireEvent.drop(t.view().contentDOM, { dataTransfer: { files: [png()] } });
    await waitFor(() => expect(t.tab("a").pendingAssets).toHaveLength(1));
    expect(body(t.view())).toBe("A\n![](images/E04-retry.png)\n末尾");
    expect(t.tab("a").pendingAssets?.[0].id).toBe("E04-retry");
    fireEvent.click(screen.getByTitle(t.paths.b));
    expect(body(t.view())).toBe(fixtures.E04.b + " B追記"); expect(selection(t.view())).toEqual(bSelection);
    expect(t.disk.get(t.paths.a)).toBe(fixtures.E04.a); expect(t.disk.get(t.paths.b)).toBe(fixtures.E04.b);
  });

  it("B03-E10 保存待ちに同じ文書へ追加入力し応答後Undoで保存済み基準へ戻る", async () => {
    const t = host("E10"), original = fixtures.E10.a;
    select(t.view(), original.length); type(t.view(), "X");
    const saved = original + "X"; t.save();
    expect(t.writes).toHaveLength(1); expect(t.writes[0].content).toBe(saved); expect(t.tab("a").saving).toBe(true);
    type(t.view(), "Y"); const edited = saved + "Y", afterInput = selection(t.view());
    await t.resolveSave(0);
    record("E10:保存応答後", t.view(), { disk: t.disk.get(t.paths.a), dirty: t.tab("a").dirty });
    expect(body(t.view())).toBe(edited); expect(selection(t.view())).toEqual(afterInput);
    expect(t.tab("a").dirty).toBe(true); expect(t.tab("a").document?.content).toBe(saved); expect(t.disk.get(t.paths.a)).toBe(saved);
    undo(t.ref); record("E10:追加入力Undo", t.view(), { disk: t.disk.get(t.paths.a), dirty: t.tab("a").dirty });
    expect(body(t.view())).toBe(saved); expect(t.tab("a").dirty).toBe(false);
    expect(selection(t.view())).toEqual({ anchor: saved.length, head: saved.length }); expect(t.disk.get(t.paths.a)).toBe(saved);
    undo(t.ref); expect(body(t.view())).toBe(original); expect(t.tab("a").dirty).toBe(true);
    undo(t.ref, true); expect(body(t.view())).toBe(saved); expect(t.tab("a").dirty).toBe(false);
    undo(t.ref, true); expect(body(t.view())).toBe(edited); expect(t.tab("a").dirty).toBe(true);
    t.save(); expect(t.writes[1].content).toBe(edited); await t.resolveSave(1);
    expect(t.disk.get(t.paths.a)).toBe(edited); expect(t.tab("a").dirty).toBe(false);
    expect(t.tab("b").draft).toBe(fixtures.E10.b); expect(t.tab("b").dirty).toBe(false);
  });
});

describe("B03-E10 保存開始と履歴の対照（新規操作件数には加算しない）", () => {
  it("Editor外の保存ボタンでも本文・逆選択を変えず保存前後のUndoを区切る", async () => {
    const t = host("E10"), original = fixtures.E10.a;
    select(t.view(), original.length); type(t.view(), "X"); select(t.view(), 4, 2);
    const before = selection(t.view()), saved = body(t.view());
    fireEvent.click(screen.getByRole("button", { name: "試験ホストの保存" }));
    expect(t.writes).toHaveLength(1); expect(t.writes[0].content).toBe(saved);
    expect(body(t.view())).toBe(saved); expect(selection(t.view())).toEqual(before);
    type(t.view(), "Y"); const after = body(t.view());
    await t.resolveSave(0);
    undo(t.ref); expect(body(t.view())).toBe(saved); expect(selection(t.view())).toEqual(before); expect(t.tab("a").dirty).toBe(false);
    undo(t.ref); expect(body(t.view())).toBe(original);
    undo(t.ref, true); undo(t.ref, true); expect(body(t.view())).toBe(after);
    const savedRedoSelection = selection(t.view());
    expect(t.disk.get(t.paths.a)).toBe(saved);
    // 逆選択を置換したRedoの選択はCodeMirror既定の写像に従う。保存なしと一致し、
    // 保存境界の修正でカーソル/選択の別仕様を導入しないことを確認する。
    const control = mount(saved, {}); select(control.view(), 4, 2); type(control.view(), "Y");
    undo(control.ref); undo(control.ref, true);
    expect(savedRedoSelection).toEqual(selection(control.view()));
  });

  it.each([false, true])("保存応答の成功／失敗=%sでは保存待ちの連続入力を余分に区切らない", async failed => {
    const t = host("E10"), original = fixtures.E10.a;
    select(t.view(), original.length); type(t.view(), "X"); t.save(); type(t.view(), "Y");
    await t.resolveSave(0, failed ? "保存拒否" : undefined);
    expect(t.tab("a").saveError).toBe(failed ? "保存拒否" : null);
    type(t.view(), "Z");
    expect(body(t.view())).toBe(original + "XYZ");
    expect(t.tab("a").saveError).toBeNull();
    undo(t.ref); expect(body(t.view())).toBe(original + "X"); expect(t.tab("a").dirty).toBe(failed);
    expect(selection(t.view())).toEqual({ anchor: original.length + 1, head: original.length + 1 });
    undo(t.ref); expect(body(t.view())).toBe(original); expect(t.tab("a").dirty).toBe(!failed);
    act(() => expect(t.ref.current!.undo()).toBe(false));
    undo(t.ref, true); undo(t.ref, true); expect(body(t.view())).toBe(original + "XYZ");
    expect(t.disk.get(t.paths.a)).toBe(original + (failed ? "" : "X"));
  });

  it("保存中の再度Ctrl+Sは二重保存も追加のUndo境界も作らない", async () => {
    const t = host("E10"), original = fixtures.E10.a;
    select(t.view(), original.length); type(t.view(), "X"); t.save(); type(t.view(), "Y");
    t.save(); type(t.view(), "Z"); expect(t.writes).toHaveLength(1);
    await t.resolveSave(0); undo(t.ref);
    expect(body(t.view())).toBe(original + "X"); expect(t.tab("a").dirty).toBe(false);
    undo(t.ref, true); expect(body(t.view())).toBe(original + "XYZ");
    expect(t.disk.get(t.paths.a)).toBe(original + "X");
  });

  it("保存が開始しないCtrl+Sは未使用のUndo項目を追加せずRedoを失わない", () => {
    const t = host("E10"), original = fixtures.E10.a;
    select(t.view(), original.length); type(t.view(), "X"); type(t.view(), "Y"); undo(t.ref);
    expect(body(t.view())).toBe(original); expect(t.tab("a").dirty).toBe(false);
    t.save(); expect(t.writes).toHaveLength(0);
    act(() => expect(t.ref.current!.undo()).toBe(false));
    undo(t.ref, true); expect(body(t.view())).toBe(original + "XY");
    expect(selection(t.view())).toEqual({ anchor: original.length + 2, head: original.length + 2 });
  });

  it("E13共通境界: 保存選択取消後に入力して再保存してもUndoは追記だけを戻す", async () => {
    const t = host("E10"), original = fixtures.E10.a;
    select(t.view(), original.length); type(t.view(), "X");
    const before = selection(t.view()); t.save(); await t.resolveSave(0, { cancelled: true });
    expect(body(t.view())).toBe(original + "X"); expect(selection(t.view())).toEqual(before);
    expect(t.disk.get(t.paths.a)).toBe(original); expect(t.tab("a").dirty).toBe(true);
    type(t.view(), "Y"); t.save(); await t.resolveSave(1);
    expect(t.disk.get(t.paths.a)).toBe(original + "XY"); expect(t.tab("a").dirty).toBe(false);
    undo(t.ref); expect(body(t.view())).toBe(original + "X"); expect(t.tab("a").dirty).toBe(true);
    expect(selection(t.view())).toEqual(before); expect(t.disk.get(t.paths.a)).toBe(original + "XY");
    undo(t.ref, true); expect(body(t.view())).toBe(original + "XY"); expect(t.tab("a").dirty).toBe(false);
  });

  it("他タブの保存応答は現在タブの連続入力を分割せず元タブの保存境界を保持する", async () => {
    const t = host("E10"), original = fixtures.E10.a, other = fixtures.E10.b;
    select(t.view(), original.length); type(t.view(), "X"); t.save(); type(t.view(), "Y");
    fireEvent.click(screen.getByTitle(t.paths.b)); select(t.view(), other.length); type(t.view(), "B");
    const bView = t.view(), beforeResponse = selection(t.view());
    await t.resolveSave(0);
    expect(t.view()).toBe(bView); expect(selection(t.view())).toEqual(beforeResponse);
    type(t.view(), "C"); undo(t.ref); expect(body(t.view())).toBe(other);
    expect(t.tab("b").dirty).toBe(false); expect(t.disk.get(t.paths.b)).toBe(other);
    fireEvent.click(screen.getByTitle(t.paths.a));
    expect(body(t.view())).toBe(original + "XY"); undo(t.ref);
    expect(body(t.view())).toBe(original + "X"); expect(t.tab("a").dirty).toBe(false);
    undo(t.ref); expect(body(t.view())).toBe(original); expect(t.disk.get(t.paths.a)).toBe(original + "X");
  });
});
