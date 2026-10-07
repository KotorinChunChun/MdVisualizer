import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useEffect, useReducer, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { foldedRanges } from "@codemirror/language";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorHistoryStore } from "./MarkdownEditor";
import { TabBar } from "./TabBar";
import { DocumentDiffWorkspace, type DiffSaveReview } from "./DocumentDiffWorkspace";
import { initialTabsState, tabsReducer, type TabsAction } from "../state/tabsReducer";
import { documentDiffTarget } from "../lib/documentDiffTarget";
import { documentDiffSavePermission } from "../lib/documentDiffSave";
import type { MarkdownLoadResult } from "../types/app";
import fixtures from "../../tests/fixtures/editor-natural-cycle04.json";

vi.mock("../features/codex/skills", () => ({ useCodexSkills: () => [], visibleSkills: (skills: unknown[]) => skills }));
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const body = (view: EditorView) => view.state.sliceDoc();
function ranges(view: EditorView) { return { mainIndex: view.state.selection.mainIndex, ranges: view.state.selection.ranges.map(({ anchor, head }) => ({ anchor, head })) }; }
function folds(view: EditorView) { const found: Array<{ from: number; to: number }> = []; foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { found.push({ from, to }); }); return found; }
function select(view: EditorView, anchor: number, head = anchor) { act(() => { view.dispatch({ selection: { anchor, head } }); view.focus(); }); }
// jsdomでは通常の文字入力だけCodeMirror公開APIを使用し、cut/pasteは実DOM handlerへ配送する。
function type(view: EditorView, text: string) {
  expect(document.activeElement).toBe(view.contentDOM);
  act(() => view.dispatch(view.state.replaceSelection(text), { userEvent: "input.type" }));
}
function undo(ref: { current: MarkdownEditorHandle | null }, redo = false) { act(() => { expect(ref.current!.undo(redo), redo ? "Redoあり" : "Undoあり").toBe(true); }); }
function record(stage: string, view: EditorView, extra: unknown = {}) { console.info(JSON.stringify({ stage, body: body(view), selection: ranges(view), folds: folds(view), extra })); }
// OS clipboardは読まない。この試験が用意した文字だけを持つDataTransfer相当を使う。
function clipboard(initial = "") {
  const data = new Map<string, string>(initial ? [["text/plain", initial]] : []);
  return { files: [], items: [], types: ["text/plain"], getData: (kind: string) => data.get(kind) ?? "", setData: (kind: string, value: string) => { data.set(kind, value); }, clearData: () => data.clear() };
}
function mount(value: string) {
  const ref = createRef<MarkdownEditorHandle>(), onChange = vi.fn();
  const result = render(<MarkdownEditor ref={ref} documentId="B04:1" value={value} dirty={false} saving={false} onChange={onChange} onSave={() => {}} />);
  return { ref, onChange, view: () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)! };
}
function doc(path: string, content: string): MarkdownLoadResult {
  return { path, content, kind: "markdown", base_dir: path.slice(0, path.lastIndexOf("/")), image_paths: [], encoding: "UTF-8", size_bytes: content.length, modified_at: "2026-10-08", revision: `revision:${content}` };
}

// 実Editor・TabBar・tabsReducer・差分部品を接続するが、App全体ではない。
// 改名/保存I/Oはメモリーであり、Appのprompt・Native/Rustのファイル操作は未確認。
function host(id: string, a: string, b: string) {
  const paths = { a: `C:/tests/B04-${id}/a.md`, b: `C:/tests/B04-${id}/b.md`, renamed: `C:/tests/B04-${id}/renamed.md` };
  const disk = new Map([[paths.a, a], [paths.b, b]]), writes: string[] = [];
  let initial = initialTabsState;
  for (const [path, content] of disk) {
    initial = tabsReducer(initial, { type: "OPEN", path });
    const tab = initial.tabs.find(item => item.path === path)!;
    initial = tabsReducer(initial, { type: "LOADED", id: tab.id, generation: tab.generation, document: doc(path, content) });
  }
  const ids = { a: initial.tabs[0].id, b: initial.tabs[1].id };
  initial = tabsReducer(initial, { type: "ACTIVATE", id: ids.a });
  const control = { state: initial, dispatch: (_action: TabsAction) => {}, review: null as DiffSaveReview | null };
  const histories: MarkdownEditorHistoryStore = new Map(), ref = createRef<MarkdownEditorHandle>();
  function Host() {
    const [state, dispatch] = useReducer(tabsReducer, initial), [showDiff, setShowDiff] = useState(false);
    const active = state.tabs.find(tab => tab.id === state.activeId)!;
    const liveHistoryKeys = state.tabs.map(tab => `${tab.id}:${tab.editorResetSequence ?? 0}`).join("\0");
    useEffect(() => {
      const alive = new Set(liveHistoryKeys.split("\0"));
      for (const key of histories.keys()) if (!alive.has(key)) histories.delete(key);
    }, [liveHistoryKeys]);
    control.state = state; control.dispatch = dispatch;
    const review = useRef<DiffSaveReview | null>(null);
    const save = async () => {
      const permission = documentDiffSavePermission(active, review.current);
      if (permission.error) throw new Error(permission.error);
      if ((!active.dirty && !permission.force) || active.saving) return;
      const request = { id: active.id, path: active.path, content: active.draft };
      dispatch({ type: "SAVE_STARTED", id: request.id, force: permission.force });
      await Promise.resolve();
      writes.push(request.path); disk.set(request.path, request.content);
      dispatch({ type: "SAVED", id: request.id, document: doc(request.path, request.content) });
    };
    return <>
      <TabBar tabs={state.tabs} activeId={state.activeId} onActivate={tabId => dispatch({ type: "ACTIVATE", id: tabId })} onClose={() => {}} onMove={() => {}} onContext={() => {}} />
      <button onClick={() => {
        expect(active.dirty).toBe(false);
        const saved = disk.get(active.path)!; disk.delete(active.path); disk.set(paths.renamed, saved);
        dispatch({ type: "RENAMED", id: active.id, document: doc(paths.renamed, saved) });
      }}>試験の改名応答</button>
      <button onClick={() => { setShowDiff(value => !value); }}>試験の差分切替</button>
      <button onClick={() => { void save(); }}>試験の保存</button>
      {active.document && (showDiff ? <DocumentDiffWorkspace key={active.id} target={documentDiffTarget(active)} editorMode="edit" theme="light" saving={active.saving}
        history={{ store: histories, key: `${active.id}:${active.editorResetSequence ?? 0}` }}
        onEditingChange={content => dispatch({ type: "DRAFT_CHANGED", id: active.id, content })}
        onReviewChange={value => { review.current = value; control.review = value; }} onSave={() => { void save(); }} />
        : <MarkdownEditor ref={ref} documentId={`${active.id}:${active.generation}`} historyKey={`${active.id}:${active.editorResetSequence ?? 0}`}
          historyStore={histories} viewStateKey={active.path} documentPath={active.path} baseDir={active.document!.base_dir}
          value={active.draft} dirty={active.dirty} saving={active.saving}
          onChange={content => dispatch({ type: "DRAFT_CHANGED", id: active.id, content })} onSave={() => { void save(); }} />)}
    </>;
  }
  const result = render(<Host />), tab = (key: "a" | "b") => control.state.tabs.find(item => item.id === ids[key])!;
  return { ref, control, paths, ids, disk, writes, tab, histories,
    diffView: () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>('[data-pane-key="result"] .cm-editor')!)!,
    view: () => EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".markdown-editor .cm-editor")!)!,
    activate: (key: "a" | "b") => fireEvent.click(screen.getByTitle(tab(key).path)),
    save: async () => { fireEvent.click(screen.getByRole("button", { name: "試験の保存" })); await waitFor(() => expect(tab(control.state.activeId === ids.a ? "a" : "b").saving).toBe(false)); },
  };
}

describe("第4組 コード・文書編集の接続回帰", () => {
  it("B04-E01 複数選択の通常入力とプレーンテキスト貼付は同じ全選択を置換する", () => {
    const f = fixtures.E01, t = mount(f.body), view = t.view();
    select(view, 0, f.needle.length);
    fireEvent.keyDown(view.contentDOM, { key: "d", code: "KeyD", ctrlKey: true });
    expect(view.state.selection.ranges).toHaveLength(2);
    const selected = ranges(view);
    type(view, f.replacement);
    const expected = f.body.split(f.needle).join(f.replacement);
    expect(body(view)).toBe(expected);
    undo(t.ref); expect(body(view)).toBe(f.body); expect(ranges(view)).toEqual(selected);
    fireEvent.paste(view.contentDOM, { clipboardData: clipboard(f.replacement) });
    record("E01:paste", view, { expected, selected });
    expect(body(view)).toBe(expected);
    undo(t.ref); expect(body(view)).toBe(f.body); expect(ranges(view)).toEqual(selected);
    undo(t.ref, true); expect(body(view)).toBe(expected);
  });

  it("B04-E02 折畳画像の切取→別tab貼付→各Undo/Redoで本文と画像データを復元する", () => {
    const f = fixtures.E02, image = `![](data:image/png;base64,${fixtures.pngBase64})`, original = f.aPrefix + image + f.aSuffix;
    const t = host("E02", original, f.b), data = clipboard();
    expect(folds(t.view())).toHaveLength(1);
    select(t.view(), f.aPrefix.length, f.aPrefix.length + image.length);
    fireEvent.cut(t.view().contentDOM, { clipboardData: data });
    expect(data.getData("text/plain")).toBe(image);
    expect(body(t.view())).toBe(f.aPrefix + f.aSuffix); expect(folds(t.view())).toHaveLength(0);
    t.activate("b"); select(t.view(), f.b.length);
    fireEvent.paste(t.view().contentDOM, { clipboardData: data });
    expect(body(t.view())).toBe(f.b + image); expect(folds(t.view())).toHaveLength(1);
    const copiedBase64 = /base64,([^)]*)/.exec(body(t.view()))![1];
    expect(Uint8Array.from(atob(copiedBase64), c => c.charCodeAt(0))).toEqual(Uint8Array.from(atob(fixtures.pngBase64), c => c.charCodeAt(0)));
    undo(t.ref); expect(body(t.view())).toBe(f.b); expect(folds(t.view())).toHaveLength(0);
    t.activate("a"); undo(t.ref); expect(body(t.view())).toBe(original); expect(folds(t.view())).toHaveLength(1);
    undo(t.ref, true); expect(body(t.view())).toBe(f.aPrefix + f.aSuffix);
    t.activate("b"); undo(t.ref, true); expect(body(t.view())).toBe(f.b + image); expect(folds(t.view())).toHaveLength(1);
    expect(t.disk.get(t.paths.a)).toBe(original); expect(t.disk.get(t.paths.b)).toBe(f.b);
    record("E02:redo", t.view(), { a: t.tab("a").draft, aDirty: t.tab("a").dirty, bDirty: t.tab("b").dirty });
  });

  it("B04-E03 番号項目の切取に伴う自動採番を1回のUndoで戻せる", async () => {
    const original = fixtures.E03, t = mount(original), view = t.view(), cut = "2. beta\n", from = original.indexOf(cut), data = clipboard();
    select(view, from, from + cut.length);
    fireEvent.cut(view.contentDOM, { clipboardData: data });
    expect(data.getData("text/plain")).toBe(cut);
    await waitFor(() => expect(body(view)).toBe("1. alpha\n2. gamma\n"));
    record("E03:renumbered", view);
    undo(t.ref); record("E03:undo", view);
    expect(body(view)).toBe(original);
    expect(ranges(view).ranges).toEqual([{ anchor: from, head: from + cut.length }]);
    undo(t.ref, true); expect(body(view)).toBe("1. alpha\n2. gamma\n");
    select(view, view.state.doc.line(2).to); type(view, "追記");
    undo(t.ref); expect(body(view)).toBe("1. alpha\n2. gamma\n");
  });

  it("B04-E08 保存済みtab改名応答後の入力保存とUndoは同じ文書の履歴を保持する", async () => {
    const f = fixtures.E08, t = host("E08", f.a, f.b), id = t.tab("a").id;
    select(t.view(), f.a.length); type(t.view(), "保存済追記"); await t.save();
    const saved = body(t.view());
    fireEvent.click(screen.getByRole("button", { name: "試験の改名応答" }));
    expect(t.tab("a").id).toBe(id); expect(t.tab("a").path).toBe(t.paths.renamed); expect(t.disk.has(t.paths.a)).toBe(false);
    select(t.view(), saved.length); type(t.view(), "改名後追記"); await t.save();
    const latest = body(t.view());
    undo(t.ref); expect(body(t.view())).toBe(saved); expect(t.tab("a").dirty).toBe(true);
    undo(t.ref); expect(body(t.view())).toBe(f.a);
    expect(t.disk.get(t.paths.renamed)).toBe(latest); expect(t.disk.has(t.paths.a)).toBe(false); expect(t.writes).toEqual([t.paths.a, t.paths.renamed]);
    expect(t.tab("b").draft).toBe(f.b); expect(t.tab("b").dirty).toBe(false);
    record("E08:undo", t.view(), { path: t.tab("a").path, disk: latest });
  });

  it("B04-E09 差分の行採用後に通常Editorへ戻り採用だけUndoして再確認保存する", async () => {
    const f = fixtures.E09, t = host("E09", f.a, f.b), start = f.a.indexOf("開始時");
    select(t.view(), start, start + "開始時".length); type(t.view(), "手編集"); expect(body(t.view())).toBe(f.local);
    act(() => t.control.dispatch({ type: "STORAGE_CONFLICT", id: t.ids.a, document: doc(t.paths.a, f.external) }));
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    expect(documentDiffSavePermission(t.tab("a"), t.control.review).error).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ストレージの2行目を採用" }));
    expect(t.tab("a").draft).toBe(f.external); expect(documentDiffSavePermission(t.tab("a"), t.control.review).error).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    expect(body(t.view())).toBe(f.external); record("E09:regular", t.view());
    undo(t.ref); expect(body(t.view())).toBe(f.local);
    undo(t.ref, true); expect(body(t.view())).toBe(f.external);
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    fireEvent.click(screen.getByRole("button", { name: "ストレージの2行目を採用" }));
    await t.save(); expect(t.disk.get(t.paths.a)).toBe(f.external); expect(t.tab("a").dirty).toBe(false);
    expect(t.tab("a").openedContent).toBe(f.external); expect(t.tab("b").draft).toBe(f.b);
  });

  it("E01補助 複数選択への行別貼付とCRLFを保ち全選択をUndoする", () => {
    const t = mount("aa\r\nbb\r\naa"), view = t.view();
    act(() => view.dispatch({ selection: EditorSelection.create([EditorSelection.range(2, 0), EditorSelection.range(8, 6)], 1) }));
    const original = ranges(view);
    fireEvent.paste(view.contentDOM, { clipboardData: clipboard("XX\r\nYY") });
    expect(body(view)).toBe("XX\nbb\nYY"); expect(t.onChange).toHaveBeenLastCalledWith("XX\r\nbb\r\nYY");
    undo(t.ref); expect(body(view)).toBe("aa\nbb\naa"); expect(ranges(view)).toEqual(original);
    undo(t.ref, true); expect(body(view)).toBe("XX\nbb\nYY");
  });

  it("E09補助 2行採用を画面往復しても1操作ずつUndo/Redoし手編集まで戻せる", () => {
    const base = "A\nB\nC\nD", t = host("E09-two", base, "別文書");
    select(t.view(), 1); type(t.view(), "追記");
    const local = body(t.view());
    act(() => t.control.dispatch({ type: "STORAGE_CONFLICT", id: t.ids.a, document: doc(t.paths.a, "A\n外部B\n外部C\nD") }));
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    fireEvent.click(screen.getByRole("button", { name: "ストレージの2行目を採用" }));
    fireEvent.click(screen.getByRole("button", { name: "ストレージの3行目を採用" }));
    expect(t.tab("a").draft).toBe("A追記\n外部B\n外部C\nD");
    fireEvent.click(screen.getByRole("button", { name: /^元に戻す$/ }));
    expect(t.tab("a").draft).toBe("A追記\n外部B\nC\nD");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    undo(t.ref); expect(body(t.view())).toBe(local);
    undo(t.ref); expect(body(t.view())).toBe(base);
    undo(t.ref, true); undo(t.ref, true); undo(t.ref, true);
    expect(body(t.view())).toBe("A追記\n外部B\n外部C\nD");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    expect(t.control.review!.unresolved).toBe(0); expect(t.disk.get(t.paths.a)).toBe(base);
  });

  it("E09補助 同じ本文の開始時採用も判断をUndoし、新しいstorage revisionは再確認する", () => {
    const base = "先頭\n開始時\n末尾", t = host("E09-metadata", base, "別文書");
    act(() => t.control.dispatch({ type: "STORAGE_CONFLICT", id: t.ids.a, document: doc(t.paths.a, "先頭\n外部\n末尾") }));
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    expect(t.control.review!.unresolved).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "開始時の2行目を復元" }));
    expect(t.tab("a").draft).toBe(base); expect(t.control.review!.unresolved).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    undo(t.ref); expect(body(t.view())).toBe(base);
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    expect(t.control.review!.unresolved).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /^やり直す$/ }));
    expect(t.control.review!.unresolved).toBe(0);
    act(() => t.control.dispatch({ type: "STORAGE_CONFLICT", id: t.ids.a,
      document: { ...doc(t.paths.a, "先頭\n外部\n末尾"), revision: "別のstorage revision" } }));
    expect(t.control.review!.unresolved).toBe(1);
    expect(documentDiffSavePermission(t.tab("a"), t.control.review).error).toBeTruthy();
  });

  it("E09補助 差分の連続入力と逆選択を通常画面でも同じ履歴へ戻す", () => {
    const t = host("E09-edit", "abcdef", "別文書");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    const view = t.diffView(); select(view, 4, 2); type(view, "X"); type(view, "Y");
    expect(t.tab("a").draft).toBe("abXYef");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    undo(t.ref); expect(body(t.view())).toBe("abcdef"); expect(ranges(t.view()).ranges).toEqual([{ anchor: 4, head: 2 }]);
    undo(t.ref, true); expect(body(t.view())).toBe("abXYef");
    select(t.view(), 4); type(t.view(), "通常");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    fireEvent.click(screen.getByRole("button", { name: /^元に戻す$/ }));
    expect(t.tab("a").draft).toBe("abXYef"); expect(t.tab("b").draft).toBe("別文書");
  });

  it("E09補助 差分による画像削除を通常Undoで完全本文・foldへ戻す", () => {
    const image = `![](data:image/png;base64,${fixtures.pngBase64})`, base = `前\n${image}\n後`, t = host("E09-fold", base, "別");
    expect(folds(t.view())).toHaveLength(1);
    act(() => t.control.dispatch({ type: "STORAGE_CONFLICT", id: t.ids.a, document: doc(t.paths.a, "前\n後") }));
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    fireEvent.click(screen.getByRole("button", { name: "ストレージの削除を採用" }));
    expect(t.tab("a").draft).toBe("前\n後");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    undo(t.ref); expect(body(t.view())).toBe(base); expect(folds(t.view())).toHaveLength(1);
    undo(t.ref, true); expect(body(t.view())).toBe("前\n後"); expect(folds(t.view())).toHaveLength(0);
  });

  it("E09補助 差分で保存中の追記だけUndoしディスクと保存済み基準は変えない", async () => {
    const t = host("E09-save", "元本文", "別文書");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    select(t.diffView(), 3); type(t.diffView(), "X");
    fireEvent.click(screen.getByRole("button", { name: "試験の保存" }));
    expect(t.tab("a").saving).toBe(true);
    type(t.diffView(), "Y");
    fireEvent.keyDown(t.diffView().contentDOM, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(t.tab("a").draft).toBe("元本文XY"); // 保存中キー経路もUndoしない。
    await waitFor(() => expect(t.tab("a").saving).toBe(false));
    expect(t.disk.get(t.paths.a)).toBe("元本文X");
    fireEvent.click(screen.getByRole("button", { name: /^元に戻す$/ }));
    expect(t.tab("a").draft).toBe("元本文X"); expect(t.tab("a").dirty).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    undo(t.ref); expect(body(t.view())).toBe("元本文"); expect(t.disk.get(t.paths.a)).toBe("元本文X");
  });

  it("E09補助 差分中のA/B往復で各Undoを保持し閉じたownerのcacheを解放する", () => {
    const t = host("E09-owner", "A本文", "B本文");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    select(t.diffView(), 3); type(t.diffView(), "A追記");
    t.activate("b"); select(t.diffView(), 3); type(t.diffView(), "B追記");
    t.activate("a"); fireEvent.click(screen.getByRole("button", { name: /^元に戻す$/ }));
    expect(t.tab("a").draft).toBe("A本文"); expect(t.tab("b").draft).toBe("B本文B追記");
    t.activate("b"); fireEvent.click(screen.getByRole("button", { name: /^元に戻す$/ }));
    expect(t.tab("b").draft).toBe("B本文");
    const closedKey = `${t.ids.a}:${t.tab("a").editorResetSequence ?? 0}`;
    expect(t.histories.has(closedKey)).toBe(true);
    act(() => t.control.dispatch({ type: "CLOSE", id: t.ids.a }));
    expect(t.histories.has(closedKey)).toBe(false);
    act(() => t.control.dispatch({ type: "OPEN", path: t.paths.a }));
    const reopened = t.control.state.tabs.find(tab => tab.path === t.paths.a)!;
    act(() => t.control.dispatch({ type: "LOADED", id: reopened.id, generation: reopened.generation, document: doc(t.paths.a, "A本文") }));
    expect(reopened.id).not.toBe(t.ids.a);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^元に戻す$/ }).disabled).toBe(true);
    expect(t.control.state.tabs.find(tab => tab.id === reopened.id)!.draft).toBe("A本文");
  });

  it("E09補助 同本文の外部再読込でも旧差分Undoを新ownerへ引き継がない", async () => {
    const t = host("E09-reload", `元本文\n![](data:image/png;base64,${fixtures.pngBase64})`, "別文書");
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    select(t.diffView(), 3); type(t.diffView(), "追記"); await t.save();
    const saved = t.tab("a"), reset = saved.editorResetSequence ?? 0;
    act(() => t.control.dispatch({ type: "RELOAD", id: saved.id }));
    act(() => t.control.dispatch({ type: "LOADED", id: saved.id, generation: t.tab("a").generation, document: doc(t.paths.a, saved.draft) }));
    expect(t.tab("a").editorResetSequence).toBe(reset + 1);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^元に戻す$/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "試験の差分切替" }));
    act(() => expect(t.ref.current!.undo()).toBe(false));
    expect(body(t.view())).toBe(saved.draft);
    expect(folds(t.view())).toHaveLength(1);
  });
});
