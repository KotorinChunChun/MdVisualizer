import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useEffect, useReducer, type ComponentProps } from "react";
import { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorHistoryStore } from "./MarkdownEditor";
import { TabBar } from "./TabBar";
import { initialTabsState, tabsReducer, type TabsAction } from "../state/tabsReducer";
import type { MarkdownLoadResult, StagedDocumentAsset } from "../types/app";
import type { ClipboardImageData, ResolvedClipboardImage } from "../lib/clipboardImage";
import fixtures from "../../tests/fixtures/editor-natural-cycle02.json";

vi.mock("../features/codex/skills", () => ({
  useCodexSkills: () => [{ id: "consult", config: { label: "AIに相談", mode: "question" } }],
  visibleSkills: (skills: unknown[]) => skills,
}));
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type EditorProps = ComponentProps<typeof MarkdownEditor>;
function mount(id: string, value: string, props: Partial<EditorProps> = {}) {
  const ref = createRef<MarkdownEditorHandle>();
  const onChange = vi.fn();
  const result = render(<MarkdownEditor documentId={`B02-${id}:1`} value={value} dirty={false} saving={false} onChange={onChange} onSave={() => {}} {...props} ref={ref} />);
  const view = () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)!;
  return { ...result, ref, view, onChange };
}
function select(view: EditorView, anchor: number, head = anchor) {
  act(() => { view.dispatch({ selection: { anchor, head } }); view.focus(); });
}
function text(view: EditorView) { return view.state.sliceDoc(); }
function selection(view: EditorView) { const { anchor, head } = view.state.selection.main; return { anchor, head }; }
function selected(view: EditorView) { const { from, to } = view.state.selection.main; return view.state.sliceDoc(from, to); }
function record(stage: string, view: EditorView, extra: unknown = {}) {
  console.info(JSON.stringify({ stage, body: text(view), selection: selection(view), focused: document.activeElement === view.contentDOM, extra }));
}
// jsdomにはOS入力がないため、通常文字入力だけ公開EditorView APIで模擬する。
// フォーカスは事前に検証し、この操作で失われたフォーカスを補修しない。
function type(view: EditorView, value: string) {
  expect(document.activeElement === view.contentDOM, "入力直前に本文へフォーカスが戻っている").toBe(true);
  act(() => view.dispatch(view.state.replaceSelection(value), { userEvent: "input.type" }));
}
function key(view: EditorView, value: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  fireEvent.keyDown(view.contentDOM, { key: value, ...modifiers });
}
function toolbar(name: string) {
  const button = screen.getByRole("button", { name });
  act(() => button.focus());
  fireEvent.click(button);
}
function undo(ref: { current: MarkdownEditorHandle | null }, redo = false) {
  let result = false;
  act(() => { result = ref.current!.undo(redo); });
  expect(result, redo ? "Redoが存在する" : "Undoが存在する").toBe(true);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const asset = (id: string): StagedDocumentAsset => ({ id, filename: `images/${id}.png`, mediaType: "image/png", base64: fixtures.pngBase64 });
const pngFile = () => new File([Uint8Array.from(atob(fixtures.pngBase64), char => char.charCodeAt(0))], "fixture.png", { type: "image/png" });
function pasteImage(view: EditorView) {
  fireEvent.paste(view.contentDOM, { clipboardData: { files: [pngFile()], items: [], getData: () => "" } });
}

// Appと同じ文書ID・viewStateKey・onChange・onSave接続で、実Editor/TabBar/reducerを使う。
// 保存/再読込アダプターだけは制御可能なメモリーI/Oへ置換する。AppのOSダイアログ、
// Tauriコマンド、実ファイルの検証はこのテストに含めず、版別native受入へ残す。
function host(id: "E07" | "E11" | "E12" | "E13" | "E14" | "E15", props: Partial<EditorProps> = {}) {
  const input = fixtures[id];
  const paths = { a: `C:/tests/B02-${id}/a.md`, b: `C:/tests/B02-${id}/b.md` };
  const disk = new Map([[paths.a, input.a], [paths.b, input.b]]);
  const loaded = (path: string, content: string): MarkdownLoadResult => ({ path, content, kind: "markdown", base_dir: path.slice(0, path.lastIndexOf("/")), image_paths: [], encoding: "UTF-8", size_bytes: content.length, modified_at: "2026-10-08", revision: `revision:${content}` });
  let initial = initialTabsState;
  for (const path of [paths.a, paths.b]) {
    initial = tabsReducer(initial, { type: "OPEN", path });
    const tab = initial.tabs.find(value => value.path === path)!;
    initial = tabsReducer(initial, { type: "LOADED", id: tab.id, generation: tab.generation, document: loaded(path, disk.get(path)!) });
  }
  initial = tabsReducer(initial, { type: "ACTIVATE", id: initial.tabs[0].id });
  const ref = createRef<MarkdownEditorHandle>();
  const controls = { state: initial, dispatch: (_action: TabsAction) => {}, save: (_id: string) => Promise.resolve(), reload: (_id: string) => {}, open: (_path: string) => {} };
  const histories: MarkdownEditorHistoryStore = new Map();
  const writes: Array<{ id: string; path: string; content: string; pending: ReturnType<typeof deferred<void>> }> = [];
  const onStagedAssetAbandoned = vi.fn();
  const onPasteImageError = vi.fn();
  const reads = vi.fn();
  function Host() {
    const [state, dispatch] = useReducer(tabsReducer, initial);
    const active = state.tabs.find(tab => tab.id === state.activeId)!;
    const historyKeys = state.tabs.filter(tab => tab.kind !== "settings").map(tab => `${tab.id}:${tab.editorResetSequence ?? 0}`).join("\0");
    useEffect(() => {
      const alive = new Set(historyKeys.split("\0"));
      for (const key of histories.keys()) if (!alive.has(key)) histories.delete(key);
    }, [historyKeys]);
    controls.state = state;
    controls.dispatch = dispatch;
    controls.open = path => dispatch({ type: "OPEN", path });
    controls.save = async tabId => {
      const tab = controls.state.tabs.find(candidate => candidate.id === tabId)!;
      if (!tab.dirty || tab.saving) return;
      const pending = deferred<void>();
      const request = { id: tab.id, path: tab.path, content: tab.draft, pending };
      writes.push(request);
      dispatch({ type: "SAVE_STARTED", id: tab.id });
      try {
        await pending.promise;
        disk.set(request.path, request.content);
        dispatch({ type: "SAVED", id: request.id, document: loaded(request.path, request.content) });
      } catch (error) { dispatch({ type: "SAVE_FAILED", id: request.id, error: String(error) }); }
    };
    controls.reload = tabId => {
      const tab = controls.state.tabs.find(candidate => candidate.id === tabId)!;
      if (tab.dirty && !window.confirm(`${tab.path}\n\n未保存の編集内容を破棄して再読み込みしますか？`)) return;
      reads(tab.path);
      dispatch({ type: "RELOAD", id: tabId });
      dispatch({ type: "LOADED", id: tabId, generation: tab.generation + 1, document: loaded(tab.path, disk.get(tab.path)!) });
    };
    return <>
      <TabBar tabs={state.tabs} activeId={state.activeId} onActivate={id => dispatch({ type: "ACTIVATE", id })} onClose={id => dispatch({ type: "CLOSE", id })} onMove={() => {}} onContext={() => {}} />
      <button onClick={() => controls.reload(active.id)}>試験ホストの再読込</button>
      {active.document && <MarkdownEditor ref={ref} documentId={`${active.id}:${active.generation}`} historyKey={`${active.id}:${active.editorResetSequence ?? 0}`} historyStore={histories} documentPath={active.path} baseDir={active.document.base_dir} viewStateKey={active.path} value={active.draft} dirty={active.dirty} saving={active.saving}
        onChange={content => dispatch({ type: "DRAFT_CHANGED", id: active.id, content })} onSave={() => void controls.save(active.id)}
        onStagedAssetAdded={(content, asset) => dispatch({ type: "STAGED_ASSET_ADDED", id: active.id, content, asset })}
        onStagedAssetAbandoned={onStagedAssetAbandoned} onPasteImageError={onPasteImageError} {...props} />}
    </>;
  }
  const result = render(<Host />);
  const view = () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)!;
  const tab = (which: "a" | "b") => controls.state.tabs.find(tab => tab.path === paths[which])!;
  const activate = (which: "a" | "b") => fireEvent.click(screen.getByTitle(paths[which]));
  const save = () => key(view(), "s", { ctrlKey: true });
  const resolveSave = async (index: number, error?: string) => {
    await act(async () => { if (error) writes[index].pending.reject(new Error(error)); else writes[index].pending.resolve(); });
  };
  return { ...result, ref, view, tab, activate, save, resolveSave, controls, paths, disk, writes, reads, histories, onStagedAssetAbandoned, onPasteImageError };
}

describe("第2組 コード画面・文書編集の自然な連続操作", () => {
  it("B02-E01 逆向き選択→太字→本文入力→Undo2/Redo2", () => {
    const original = fixtures.E01, t = mount("E01", original);
    const from = original.indexOf("target"), to = from + 6;
    select(t.view(), to, from);
    toolbar("太字");
    expect(text(t.view())).toBe("前 **target** 後");
    expect(selected(t.view())).toBe("target");
    type(t.view(), "new");
    expect(text(t.view())).toBe("前 **new** 後");
    undo(t.ref); record("E01:Undo1", t.view()); expect(text(t.view())).toBe("前 **target** 後");
    undo(t.ref); record("E01:Undo2", t.view());
    expect(text(t.view())).toBe(original); expect(selection(t.view())).toEqual({ anchor: to, head: from });
    undo(t.ref, true); expect(text(t.view())).toBe("前 **target** 後");
    undo(t.ref, true); expect(text(t.view())).toBe("前 **new** 後");
  });
  it("B02-E02 次行頭を終端とする複数行選択→Tab/Shift+Tab→Undo/Redo", () => {
    const original = fixtures.E02, t = mount("E02", original);
    const end = original.indexOf("gamma");
    select(t.view(), 0, end);
    key(t.view(), "Tab");
    expect(text(t.view())).toBe("  alpha\n  beta\ngamma");
    expect(selection(t.view())).toEqual({ anchor: 2, head: end + 4 });
    key(t.view(), "Tab", { shiftKey: true });
    expect(text(t.view())).toBe(original); expect(selection(t.view())).toEqual({ anchor: 0, head: end });
    undo(t.ref); expect(text(t.view())).toBe("  alpha\n  beta\ngamma");
    undo(t.ref); expect(text(t.view())).toBe(original);
    undo(t.ref, true); expect(text(t.view())).toBe("  alpha\n  beta\ngamma");
    undo(t.ref, true); expect(text(t.view())).toBe(original);
  });
  it("B02-E03 親子リスト選択→未完了→完了→箇条書き→Undo3", () => {
    const original = fixtures.E03, t = mount("E03", original);
    select(t.view(), 0, original.indexOf("\n- sibling"));
    const unchecked = "- [ ] parent\n  - [ ] child\n- sibling";
    const checked = "- [x] parent\n  - [x] child\n- sibling";
    key(t.view(), "[", { ctrlKey: true }); expect(text(t.view())).toBe(unchecked);
    expect(selected(t.view())).toBe(unchecked.slice(0, unchecked.indexOf("\n- sibling")));
    key(t.view(), "]", { ctrlKey: true }); expect(text(t.view())).toBe(checked);
    key(t.view(), ".", { ctrlKey: true }); expect(text(t.view())).toBe(original);
    undo(t.ref); expect(text(t.view())).toBe(checked);
    undo(t.ref); expect(text(t.view())).toBe(unchecked);
    undo(t.ref); expect(text(t.view())).toBe(original);
    expect(selection(t.view())).toEqual({ anchor: 0, head: original.indexOf("\n- sibling") });
  });
  it("B02-E04 フェンス内→Mermaid挿入→雛形入力→Undo2", () => {
    const original = fixtures.E04, t = mount("E04", original);
    const caret = original.indexOf("original") + 3;
    select(t.view(), caret); toolbar("Mermaid図を挿入");
    const inserted = text(t.view());
    // 既存の閉じフェンス行末LFを保持し、その次へブロックを挿入する。
    expect(inserted).toBe(original.replace("after", "\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter"));
    expect(selected(t.view())).toBe("graph TD\n  A --> B");
    type(t.view(), "flowchart LR\n  X --> Y");
    expect(text(t.view())).toBe(inserted.replace("graph TD\n  A --> B", "flowchart LR\n  X --> Y"));
    undo(t.ref); record("E04:Undo1", t.view()); expect(text(t.view())).toBe(inserted);
    undo(t.ref); expect(text(t.view())).toBe(original); expect(selection(t.view())).toEqual({ anchor: caret, head: caret });
  });
  it("B02-E05 画像貼付待ちにカーソルだけ動かしても元の選択を置換する", async () => {
    const pending = deferred<ResolvedClipboardImage>(), resolver = vi.fn((_image: ClipboardImageData) => pending.promise), added = vi.fn();
    const t = mount("E05", fixtures.E05, { onResolvePastedImage: resolver, onStagedAssetAdded: added });
    select(t.view(), 2, 6); pasteImage(t.view());
    await waitFor(() => expect(resolver).toHaveBeenCalledOnce());
    expect(resolver.mock.calls[0][0]).toEqual({ mediaType: "image/png", base64: fixtures.pngBase64 });
    select(t.view(), fixtures.E05.length);
    const image = asset("E05"); await act(async () => pending.resolve({ source: image.filename, asset: image }));
    expect(text(t.view())).toBe("前\n![](images/E05.png)\n後"); expect(added).toHaveBeenCalledOnce();
    undo(t.ref); expect(text(t.view())).toBe(fixtures.E05);
  });
  it("B02-E06 画像貼付待ちの本文編集で取消→再試行→Undo", async () => {
    const first = deferred<ResolvedClipboardImage>(), resolver = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ source: "images/E06-retry.png", asset: asset("E06-retry") });
    const abandoned = vi.fn(), added = vi.fn(), errors = vi.fn();
    const t = mount("E06", fixtures.E06, { onResolvePastedImage: resolver, onStagedAssetAbandoned: abandoned, onStagedAssetAdded: added, onPasteImageError: errors });
    select(t.view(), 2, 4); pasteImage(t.view()); await waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    select(t.view(), fixtures.E06.length); type(t.view(), "追記");
    const edited = fixtures.E06 + "追記", stale = asset("E06-stale");
    await act(async () => first.resolve({ source: stale.filename, asset: stale }));
    expect(text(t.view())).toBe(edited); expect(abandoned).toHaveBeenCalledExactlyOnceWith(stale); expect(added).not.toHaveBeenCalled(); expect(errors).toHaveBeenCalledOnce();
    pasteImage(t.view()); await waitFor(() => expect(added).toHaveBeenCalledOnce());
    expect(text(t.view())).toBe(edited + "![](images/E06-retry.png)");
    undo(t.ref); expect(text(t.view())).toBe(edited); expect(abandoned).toHaveBeenCalledTimes(1);
  });
  it("B02-E07 Aドロップ待ち→B入力→Aの遅延応答を棄却→Aで再試行", async () => {
    const pending = deferred<ResolvedClipboardImage>(), resolver = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ source: "images/E07-retry.png", asset: asset("E07-retry") });
    const t = host("E07", { onResolveFileAttachment: resolver });
    select(t.view(), 2, 4); fireEvent.drop(t.view().contentDOM, { dataTransfer: { files: [pngFile()] } });
    expect(resolver).toHaveBeenCalledTimes(1);
    t.activate("b"); select(t.view(), fixtures.E07.b.length); type(t.view(), "B追記");
    const beforeB = { ...t.tab("b") }, bSelection = selection(t.view()), stale = asset("E07-stale");
    await act(async () => pending.resolve({ source: stale.filename, asset: stale }));
    expect(t.tab("b")).toEqual(beforeB); expect(selection(t.view())).toEqual(bSelection); expect(text(t.view())).toBe(fixtures.E07.b + "B追記");
    expect(t.onStagedAssetAbandoned).toHaveBeenCalledExactlyOnceWith(stale); expect(t.onPasteImageError).toHaveBeenCalledOnce();
    t.activate("a"); expect(text(t.view())).toBe(fixtures.E07.a); expect(t.tab("a").dirty).toBe(false);
    select(t.view(), 2, 4); fireEvent.drop(t.view().contentDOM, { dataTransfer: { files: [pngFile()] } });
    await waitFor(() => expect(t.tab("a").pendingAssets).toHaveLength(1));
    expect(text(t.view())).toBe("A\n![](images/E07-retry.png)\n末尾"); expect(t.tab("a").dirty).toBe(true);
  });
  it("B02-E08 選択外右クリックと選択内右クリックのコピー対象を分離", () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.assign(navigator, { clipboard: { writeText } });
    const original = fixtures.E08, t = mount("E08", original);
    select(t.view(), 2, 9); const initialSelection = selection(t.view());
    const coords = vi.spyOn(t.view(), "posAtCoords").mockReturnValue(original.indexOf("別の段落"));
    fireEvent.contextMenu(t.view().contentDOM); fireEvent.click(screen.getByRole("menuitem", { name: "コードをMarkdownでコピー" }));
    expect(writeText).toHaveBeenNthCalledWith(1, "別の段落");
    coords.mockReturnValue(5); fireEvent.contextMenu(t.view().contentDOM); fireEvent.click(screen.getByRole("menuitem", { name: "コードをMarkdownでコピー" }));
    expect(writeText).toHaveBeenNthCalledWith(2, "対象1\n対象2");
    expect(text(t.view())).toBe(original); expect(selection(t.view())).toEqual(initialSelection); expect(t.onChange).not.toHaveBeenCalled();
    act(() => { expect(t.ref.current!.undo()).toBe(false); });
  });
  it("B02-E09 右クリックメニューのキー移動→Escape→即入力→Undo", () => {
    const original = fixtures.E09, t = mount("E09", original, { onCodexConsult: vi.fn() });
    select(t.view(), 2, 8); vi.spyOn(t.view(), "posAtCoords").mockReturnValue(4);
    fireEvent.contextMenu(t.view().contentDOM);
    expect(document.activeElement?.textContent).toBe("AIに相談");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("プレーンテキストでコピー");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull(); record("E09:Escape", t.view());
    expect(selection(t.view())).toEqual({ anchor: 2, head: 8 });
    type(t.view(), "new"); expect(text(t.view())).toBe("前 new 後");
    undo(t.ref); expect(text(t.view())).toBe(original);
  });
  it("B02-E10 表内の無効ボタン→表外で有効→コード挿入→Undo", () => {
    const original = fixtures.E10, t = mount("E10", original);
    select(t.view(), original.indexOf("one") + 1);
    const button = screen.getByRole("button", { name: "コードブロック" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button); expect(text(t.view())).toBe(original);
    const caret = original.length; select(t.view(), caret); expect(button.disabled).toBe(false);
    toolbar("コードブロック"); expect(text(t.view())).toBe(original + "\n\n```text\nコード\n```\n\n"); expect(selected(t.view())).toBe("コード");
    undo(t.ref); expect(text(t.view())).toBe(original); expect(selection(t.view())).toEqual({ anchor: caret, head: caret });
  });
  it("B02-E11 A入力と逆選択→B入力→Aへ戻って置換/Undo→B状態保持", async () => {
    const t = host("E11");
    select(t.view(), fixtures.E11.a.length); type(t.view(), "A追記");
    const aDraft = text(t.view()); select(t.view(), 4, 2); t.view().scrollDOM.scrollTop = 37;
    t.activate("b"); select(t.view(), fixtures.E11.b.length); type(t.view(), "B追記");
    const bDraft = text(t.view()), bSelection = selection(t.view());
    t.activate("a"); expect(text(t.view())).toBe(aDraft); expect(selection(t.view())).toEqual({ anchor: 4, head: 2 });
    await waitFor(() => expect(t.view().scrollDOM.scrollTop).toBe(37));
    type(t.view(), "変更"); expect(text(t.view())).toBe("A\n変更\n末尾A追記");
    undo(t.ref); expect(text(t.view())).toBe(aDraft); expect(t.tab("a").dirty).toBe(true);
    t.activate("b"); expect(text(t.view())).toBe(bDraft); expect(selection(t.view())).toEqual(bSelection); expect(t.tab("b").dirty).toBe(true);
  });
  it("B02-E12 同一ファイルを通常/拡張長パスで開き直してもdraftと履歴を再利用", () => {
    const t = host("E12"), initialView = t.view(), originalId = t.tab("a").id;
    select(t.view(), fixtures.E12.a.length); type(t.view(), "追記"); select(t.view(), 4, 2);
    const before = text(t.view());
    act(() => t.controls.open(t.paths.a));
    act(() => t.controls.open("\\\\?\\" + t.paths.a.replace(/\//g, "\\")));
    expect(t.controls.state.tabs).toHaveLength(2); expect(t.controls.state.activeId).toBe(originalId); expect(t.view()).toBe(initialView);
    expect(text(t.view())).toBe(before); expect(selection(t.view())).toEqual({ anchor: 4, head: 2 }); expect(t.tab("a").dirty).toBe(true); expect(t.reads).not.toHaveBeenCalled();
    type(t.view(), "変更"); expect(text(t.view())).toBe("A\n変更\n末尾追記");
    undo(t.ref); expect(text(t.view())).toBe(before);
    undo(t.ref); expect(text(t.view())).toBe(fixtures.E12.a);
  });
  it("B02-E13 A保存待ち→B入力→A保存応答でもBの本文/dirty/選択/focusを保持", async () => {
    const t = host("E13"); select(t.view(), fixtures.E13.a.length); type(t.view(), "A追記");
    const aDraft = text(t.view()); t.save(); expect(t.tab("a").saving).toBe(true);
    t.activate("b"); select(t.view(), fixtures.E13.b.length); type(t.view(), "B追記");
    const b = { ...t.tab("b") }, bView = t.view(), beforeSelection = selection(t.view());
    await t.resolveSave(0);
    expect(t.tab("b")).toEqual(b); expect(t.view()).toBe(bView); expect(selection(t.view())).toEqual(beforeSelection); expect(document.activeElement).toBe(bView.contentDOM);
    expect(t.controls.state.activeId).toBe(b.id); expect(t.disk.get(t.paths.a)).toBe(aDraft); expect(t.disk.get(t.paths.b)).toBe(fixtures.E13.b);
    t.activate("a"); expect(text(t.view())).toBe(aDraft); expect(t.tab("a").dirty).toBe(false); expect(t.tab("a").openedContent).toBe(aDraft);
  });
  it("B02-E14 再読込の破棄確認を取消→選択へ入力→Undo→保存", async () => {
    const t = host("E14"), confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    select(t.view(), fixtures.E14.a.length); type(t.view(), "追記"); select(t.view(), 4, 2);
    const before = text(t.view()), beforeView = t.view(), generation = t.tab("a").generation;
    // jsdomのclickはOS focusを再現しない。この確認取消後focusはnative受入で別途確認する。
    fireEvent.click(screen.getByRole("button", { name: "試験ホストの再読込" }));
    expect(confirm).toHaveBeenCalledOnce(); expect(t.reads).not.toHaveBeenCalled(); expect(t.view()).toBe(beforeView);
    expect(t.tab("a").generation).toBe(generation); expect(t.tab("a").dirty).toBe(true); expect(text(t.view())).toBe(before); expect(selection(t.view())).toEqual({ anchor: 4, head: 2 });
    type(t.view(), "変更"); expect(text(t.view())).toBe("A\n変更\n末尾追記");
    undo(t.ref); expect(text(t.view())).toBe(before); t.save(); await t.resolveSave(0);
    expect(t.disk.get(t.paths.a)).toBe(before); expect(t.tab("a").dirty).toBe(false);
  });
  it("B02-E15 保存失敗→続けて編集→再保存成功→Undoで直前編集へ戻る", async () => {
    const t = host("E15"); select(t.view(), fixtures.E15.a.length); type(t.view(), "追記"); select(t.view(), 4, 2);
    const before = text(t.view()); t.save(); await t.resolveSave(0, "試験用の保存拒否");
    expect(text(t.view())).toBe(before); expect(selection(t.view())).toEqual({ anchor: 4, head: 2 }); expect(t.tab("a").dirty).toBe(true); expect(t.tab("a").saveError).toContain("試験用の保存拒否"); expect(t.disk.get(t.paths.a)).toBe(fixtures.E15.a);
    type(t.view(), "変更"); const latest = "A\n変更\n末尾追記"; expect(text(t.view())).toBe(latest);
    t.save(); expect(t.writes.map(value => value.content)).toEqual([before, latest]); await t.resolveSave(1);
    expect(t.tab("a").saveError).toBeNull(); expect(t.tab("a").dirty).toBe(false); expect(t.disk.get(t.paths.a)).toBe(latest);
    record("E15:保存成功後", t.view(), { generation: t.tab("a").generation });
    undo(t.ref); expect(text(t.view())).toBe(before); expect(t.tab("a").dirty).toBe(true); expect(t.disk.get(t.paths.a)).toBe(latest);
  });
});

describe("B02修正の対照試験（新規15ケースの件数には含めない）", () => {
  it("設定タブへの切替でEditorがunmountしても文書へ戻るとUndoを復元する", () => {
    const t = host("E11"); select(t.view(), fixtures.E11.a.length); type(t.view(), "設定前の追記");
    act(() => t.controls.dispatch({ type: "OPEN_SETTINGS" }));
    expect(t.container.querySelector(".cm-editor")).toBeNull(); expect(t.histories.size).toBe(1);
    t.activate("a"); expect(text(t.view())).toBe(fixtures.E11.a + "設定前の追記");
    undo(t.ref); expect(text(t.view())).toBe(fixtures.E11.a);
  });
  it("閉じたタブのcacheを削除し、同じパスの再オープンへ古いUndoを混入しない", () => {
    const t = host("E12"), oldTab = t.tab("a");
    select(t.view(), fixtures.E12.a.length); type(t.view(), "閉じる前の追記"); t.activate("b");
    expect(t.histories.size).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "a.md を閉じる" })); expect(t.histories.size).toBe(0);
    act(() => t.controls.open(t.paths.a)); const reopened = t.tab("a");
    act(() => t.controls.dispatch({ type: "LOADED", id: reopened.id, generation: reopened.generation, document: oldTab.document! }));
    expect(reopened.id).not.toBe(oldTab.id); expect(text(t.view())).toBe(fixtures.E12.a);
    act(() => { expect(t.ref.current!.undo()).toBe(false); });
  });
  it("保存後も競合用documentIdは更新し、古い提案を拒否してUndoを保持する", async () => {
    const t = host("E15"); select(t.view(), fixtures.E15.a.length); type(t.view(), "追記");
    const old = t.ref.current!.snapshot()!, beforeView = t.view();
    t.save(); await t.resolveSave(0);
    const current = t.ref.current!.snapshot()!;
    expect(current.documentId).not.toBe(old.documentId); expect(t.view()).toBe(beforeView);
    act(() => { expect(t.ref.current!.applyProposal(old, "古い応答")).toBe(false); });
    undo(t.ref); expect(text(t.view())).toBe(fixtures.E15.a); expect(t.tab("a").dirty).toBe(true);
  });
  it("A/Bを切り替えても切替前の履歴を文書ごとに保持する", () => {
    const t = host("E11"); select(t.view(), fixtures.E11.a.length); type(t.view(), "A追記");
    t.activate("b"); select(t.view(), fixtures.E11.b.length); type(t.view(), "B追記");
    t.activate("a"); undo(t.ref); expect(text(t.view())).toBe(fixtures.E11.a);
    t.activate("b"); expect(text(t.view())).toBe(fixtures.E11.b + "B追記");
    undo(t.ref); expect(text(t.view())).toBe(fixtures.E11.b);
    t.activate("a"); undo(t.ref, true); expect(text(t.view())).toBe(fixtures.E11.a + "A追記");
  });
  it("履歴をタブ間で復元しても画像のUndo/Redo用fold effectを失わない", () => {
    const t = host("E11"), image = "![](data:image/png;base64," + fixtures.pngBase64.repeat(24) + ")";
    select(t.view(), fixtures.E11.a.length);
    fireEvent.paste(t.view().contentDOM, { clipboardData: { files: [], items: [], getData: () => image } });
    const folds = () => { let n = 0; foldedRanges(t.view().state).between(0, t.view().state.doc.length, () => { n++; }); return n; };
    expect(folds()).toBe(1); t.activate("b"); t.activate("a");
    undo(t.ref); expect(text(t.view())).toBe(fixtures.E11.a); expect(folds()).toBe(0);
    undo(t.ref, true); expect(text(t.view())).toBe(fixtures.E11.a + image); expect(folds()).toBe(1);
  });
  it.each([false, true])("アプリ再読込は同じ本文=%sでも過去の編集履歴をリセットする", async sameContent => {
    const t = host("E14"); select(t.view(), fixtures.E14.a.length); type(t.view(), "追記");
    t.save(); await t.resolveSave(0);
    const before = text(t.view()), external = sameContent ? before : "外部で更新された本文";
    t.disk.set(t.paths.a, external); const sequence = t.tab("a").editorResetSequence;
    fireEvent.click(screen.getByRole("button", { name: "試験ホストの再読込" }));
    expect(t.tab("a").editorResetSequence).toBe((sequence ?? 0) + 1); expect(text(t.view())).toBe(external);
    act(() => { expect(t.ref.current!.undo()).toBe(false); });
    select(t.view(), external.length); type(t.view(), "新入力"); undo(t.ref); expect(text(t.view())).toBe(external);
  });
  it("保存先だけ変更した同じタブのUndo履歴を保持する", () => {
    const t = host("E12"); select(t.view(), fixtures.E12.a.length); type(t.view(), "追記");
    const saved = t.tab("a"), target = "C:/tests/B02-E12-saved-as/a.md";
    act(() => t.controls.dispatch({ type: "SAVED", id: saved.id, document: { ...saved.document!, path: target, base_dir: "C:/tests/B02-E12-saved-as", content: saved.draft } }));
    expect(t.ref.current!.snapshot()!.documentId).toBe(`${saved.id}:${saved.generation + 1}`);
    undo(t.ref); expect(text(t.view())).toBe(fixtures.E12.a);
    expect(t.controls.state.tabs.find(tab => tab.id === saved.id)!.dirty).toBe(true);
  });
  it("非アクティブ文書の外部更新を受け入れた後、古いタブ履歴を混入しない", async () => {
    const t = host("E13"); select(t.view(), fixtures.E13.a.length); type(t.view(), "追記");
    t.save(); await t.resolveSave(0); const saved = t.tab("a"); t.activate("b");
    act(() => {
      t.controls.dispatch({ type: "STORAGE_REQUESTED", id: saved.id, request: 1 });
      t.controls.dispatch({ type: "STORAGE_LOADED", id: saved.id, request: 1, generation: saved.generation, changeSequence: saved.changeSequence ?? 0, reloadIfClean: true, document: { ...saved.document!, content: "外部変更A" } });
    });
    t.activate("a"); expect(text(t.view())).toBe("外部変更A");
    act(() => { expect(t.ref.current!.undo()).toBe(false); });
  });
  it.each([false, true])("AI全文置換に含まれる選択（逆方向=%s）を有効に保ちUndoできる", reverse => {
    const t = mount(`R13-${reverse}`, "前A中B後"); select(t.view(), reverse ? 4 : 3, reverse ? 3 : 4);
    const beforeSelection = selection(t.view()), base = { ...t.ref.current!.snapshot()!, from: 0, to: 5 };
    act(() => { expect(t.ref.current!.applyProposal(base, "前X中Y後")).toBe(true); });
    expect(text(t.view())).toBe("前X中Y後"); expect(selection(t.view())).toEqual(beforeSelection);
    expect(t.container.querySelector(".cm-selection-range")?.textContent).toBe("Y");
    undo(t.ref); expect(text(t.view())).toBe("前A中B後"); expect(selection(t.view())).toEqual(beforeSelection);
    expect(t.container.querySelector(".cm-selection-range")?.textContent).toBe("B");
    undo(t.ref, true); expect(text(t.view())).toBe("前X中Y後");
    expect(selection(t.view())).toEqual(beforeSelection); expect(t.container.querySelector(".cm-selection-range")?.textContent).toBe("Y");
  });
});
