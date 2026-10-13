import { describe, expect, it, vi } from "vitest";
import { closeTabsSequentially, confirmUnchangedTabAction, handleWindowCloseRequest, unchangedTabForAction } from "./lib/documentActions";
import { initialTabsState, tabsReducer, type TabsAction, type TabState } from "./state/tabsReducer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("ネイティブの非同期破棄確認", () => {
  it("同期falseではウィンドウを破棄しない", async () => {
    const destroy = vi.fn(async () => {}), preventDefault = vi.fn();
    await handleWindowCloseRequest(true, () => false, { preventDefault }, destroy);
    expect(preventDefault).toHaveBeenCalledOnce(); expect(destroy).not.toHaveBeenCalled();
  });
  it("Promise falseの取消ではウィンドウを破棄しない", async () => {
    const destroy = vi.fn(async () => {}), preventDefault = vi.fn();
    await handleWindowCloseRequest(true, () => Promise.resolve(false), { preventDefault }, destroy);
    expect(preventDefault).toHaveBeenCalledOnce(); expect(destroy).not.toHaveBeenCalled();
  });
  it("確認の応答を待ち、trueが返った後だけ破棄する", async () => {
    const answer = deferred<boolean>(), destroy = vi.fn(async () => {}), preventDefault = vi.fn();
    const operation = handleWindowCloseRequest(true, () => answer.promise, { preventDefault }, destroy);
    expect(preventDefault).toHaveBeenCalledOnce(); expect(destroy).not.toHaveBeenCalled();
    answer.resolve(true); await operation; expect(destroy).toHaveBeenCalledOnce();
  });
  it("確認中に全タブ状態が変わるとtrueでも終了しない", async () => {
    const answer = deferred<boolean>(), destroy = vi.fn(async () => {});
    let current = true;
    const operation = handleWindowCloseRequest(true, () => answer.promise, { preventDefault: vi.fn() }, destroy, () => current);
    current = false; answer.resolve(true); await operation;
    expect(destroy).not.toHaveBeenCalled();
  });
  it("確認APIエラーでは終了せず呼出し元へ通知する", async () => {
    const destroy = vi.fn(async () => {});
    await expect(handleWindowCloseRequest(true, async () => { throw new Error("native dialog failure"); }, { preventDefault: vi.fn() }, destroy)).rejects.toThrow("native dialog failure");
    expect(destroy).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 1, "true"])("true以外の応答=%sでは終了しない", async value => {
    const destroy = vi.fn(async () => {});
    await handleWindowCloseRequest(true, (() => Promise.resolve(value)) as unknown as () => Promise<boolean>, { preventDefault: vi.fn() }, destroy);
    expect(destroy).not.toHaveBeenCalled();
  });
});

function tabHost() {
  let state = tabsReducer(initialTabsState, { type: "OPEN", path: "C:/tests/async-confirm.md" });
  const id = state.activeId!;
  state = tabsReducer(state, { type: "LOADED", id, generation: state.tabs[0].generation, document: {
    path: "C:/tests/async-confirm.md", content: "保存済み本文", kind: "markdown", base_dir: "C:/tests",
    image_paths: [], encoding: "UTF-8", size_bytes: 18, modified_at: "2026-10-08", revision: "saved-revision",
  } });
  state = tabsReducer(state, { type: "DRAFT_CHANGED", id, content: "破棄してはいけない下書き" });
  return {
    id,
    current: () => state.tabs.find(tab => tab.id === id),
    dispatch: (action: TabsAction) => { state = tabsReducer(state, action); },
  };
}
describe("確認対象文書の所有・世代保護", () => {
  it.each([false, true])("同期回答=%sとPromise回答は同じ可否になる", async answer => {
    const host = tabHost(), before = host.current()!;
    expect(await confirmUnchangedTabAction(before, host.current, "破棄確認", () => answer)).toBe(answer);
    expect(await confirmUnchangedTabAction(before, host.current, "破棄確認", async () => answer)).toBe(answer);
  });
  it("Promise falseではCLOSEもasset破棄も実行しない", async () => {
    const host = tabHost(), before = host.current()!, response = deferred<boolean>(), discard = vi.fn();
    const close = (async () => {
      if (!await confirmUnchangedTabAction(before, host.current, "閉じる", () => response.promise)) return false;
      discard(); host.dispatch({ type: "CLOSE", id: host.id }); return true;
    })();
    expect(host.current()).toBe(before); expect(discard).not.toHaveBeenCalled();
    response.resolve(false); expect(await close).toBe(false);
    expect(host.current()).toBe(before); expect(discard).not.toHaveBeenCalled();
  });
  it("Promise true後だけRELOADし、取消ならgenerationとdraftを維持する", async () => {
    for (const answer of [false, true]) {
      const host = tabHost(), before = host.current()!, response = deferred<boolean>();
      const reload = (async () => {
        if (!await confirmUnchangedTabAction(before, host.current, "再読込", () => response.promise)) return;
        host.dispatch({ type: "RELOAD", id: host.id });
      })();
      expect(host.current()).toBe(before); response.resolve(answer); await reload;
      expect(host.current()?.generation).toBe(before.generation + (answer ? 1 : 0));
      expect(host.current()?.draft).toBe(before.draft);
    }
  });
  it("確認待ちの追加入力をtrue応答で破棄しない", async () => {
    const host = tabHost(), before = host.current()!, response = deferred<boolean>();
    const result = confirmUnchangedTabAction(before, host.current, "閉じる", () => response.promise);
    host.dispatch({ type: "DRAFT_CHANGED", id: host.id, content: before.draft + "追記" }); response.resolve(true);
    expect(await result).toBe(false); expect(host.current()?.draft).toBe(before.draft + "追記");
  });
  it("確認中に入力して元本文へUndoしても古い同意を流用しない", async () => {
    const host = tabHost(), before = host.current()!, response = deferred<boolean>();
    const result = confirmUnchangedTabAction(before, host.current, "閉じる", () => response.promise);
    host.dispatch({ type: "DRAFT_CHANGED", id: host.id, content: before.draft + "追記" });
    host.dispatch({ type: "DRAFT_CHANGED", id: host.id, content: before.draft }); response.resolve(true);
    expect(await result).toBe(false);
  });
  it.each(["save", "reload", "close", "asset"])("確認中の%sで対象状態が変われば処理しない", async operation => {
    const host = tabHost(), before = host.current()!, response = deferred<boolean>();
    const result = confirmUnchangedTabAction(before, host.current, "破棄確認", () => response.promise);
    if (operation === "save") host.dispatch({ type: "SAVE_STARTED", id: host.id });
    if (operation === "reload") host.dispatch({ type: "RELOAD", id: host.id });
    if (operation === "close") host.dispatch({ type: "CLOSE", id: host.id });
    if (operation === "asset") host.dispatch({ type: "STAGED_ASSET_ADDED", id: host.id, content: before.draft, asset: { id: "new", filename: "new.png", mediaType: "image/png", base64: "AA==" } });
    response.resolve(true); expect(await result).toBe(false);
  });
  it("タブ切替とscrollだけなら元の対象を許可し、別タブは対象にしない", async () => {
    const host = tabHost(), before = host.current()!, response = deferred<boolean>();
    const result = confirmUnchangedTabAction(before, host.current, "破棄確認", () => response.promise);
    host.dispatch({ type: "NEW_MARKDOWN" }); host.dispatch({ type: "SCROLL", id: host.id, scrollTop: 180 });
    response.resolve(true); expect(await result).toBe(true);
    expect(host.current()?.id).toBe(before.id); expect(host.current()?.scrollTop).toBe(180);
  });
  it("同じパス・本文でも別IDへの再接続は許可しない", () => {
    const before = tabHost().current()!;
    expect(unchangedTabForAction(before, { ...before, id: "reopened" })).toBe(false);
  });
  it.each(["path", "revision"])("確認中の%s変更を拒否する", property => {
    const before = tabHost().current()!;
    const current: TabState = property === "path" ? { ...before, path: "C:/changed.md" }
      : { ...before, document: { ...before.document!, revision: "external-new" } };
    expect(unchangedTabForAction(before, current)).toBe(false);
  });
  it("変換確認のnativeエラーは後続の配置や保存へ進めない", async () => {
    const before = tabHost().current()!, save = vi.fn();
    await expect((async () => {
      if (await confirmUnchangedTabAction(before, () => before, "変換", async () => { throw new Error("dialog failed"); })) save();
    })()).rejects.toThrow("dialog failed");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("複数タブの逐次閉鎖", () => {
  it("1つ目の回答を待ち、2つ目の取消で以降を閉じない", async () => {
    const first = deferred<boolean>(), close = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(false);
    const operation = closeTabsSequentially(["a", "b", "c"], close);
    expect(close.mock.calls).toEqual([["a"]]); first.resolve(true); expect(await operation).toBe(false);
    expect(close.mock.calls).toEqual([["a"], ["b"]]);
  });
  it("各対象が許可された場合だけ指定した順序で閉じる", async () => {
    const close = vi.fn(async () => true);
    expect(await closeTabsSequentially(["a", "b", "c"], close)).toBe(true);
    expect(close.mock.calls).toEqual([["a"], ["b"], ["c"]]);
  });
});
