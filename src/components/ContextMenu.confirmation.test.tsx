import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import type { TabState } from "../state/tabsReducer";

vi.mock("../lib/commands", () => ({ openContainingFolder: vi.fn(), openExternalUrl: vi.fn(), openInEditor: vi.fn() }));
afterEach(cleanup);
const tab: TabState = { id: "fixture", path: "C:/tests/confirm.md", document: null, error: null, loading: false, scrollTop: 0,
  generation: 1, draft: "fixture", dirty: false, saving: false, saveError: null, editorMode: "edit", imageDisplaySizes: {},
  search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } };

function setup(action: () => boolean | Promise<boolean>) {
  const onResult = vi.fn(), onError = vi.fn(), onDismiss = vi.fn();
  render(<ContextMenu tab={tab} x={0} y={0} onDismiss={onDismiss} onClose={action} onCloseOthers={action} onCloseRight={action}
    onRename={action} onResult={onResult} onError={onError} />);
  return { onResult, onError, onDismiss };
}

describe("タブ操作の非同期確認結果", () => {
  it.each(["タブを閉じる", "他のタブを閉じる", "右側のタブを閉じる", "ファイル名を変更"])("%sのPromise falseでは成功通知を表示しない", async label => {
    const action = vi.fn(async () => false), result = setup(action);
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: label })); });
    expect(action).toHaveBeenCalledOnce(); expect(result.onResult).not.toHaveBeenCalled(); expect(result.onError).not.toHaveBeenCalled();
  });
  it("確認が保留中なら成功通知せず、許可trueの完了後にだけ表示する", async () => {
    let resolve!: (value: boolean) => void;
    const pending = new Promise<boolean>(done => { resolve = done; });
    const action = vi.fn(() => pending), result = setup(action);
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "タブを閉じる" })); });
    expect(action).toHaveBeenCalledOnce(); expect(result.onDismiss).toHaveBeenCalled(); expect(result.onResult).not.toHaveBeenCalled();
    await act(async () => resolve(true)); expect(result.onResult).toHaveBeenCalledExactlyOnceWith("タブを閉じました");
  });
  it("確認エラーは成功とせず既存のエラー通知へ渡す", async () => {
    const result = setup(async () => { throw new Error("native confirm failed"); });
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "タブを閉じる" })); });
    expect(result.onResult).not.toHaveBeenCalled(); expect(result.onError).toHaveBeenCalledExactlyOnceWith("Error: native confirm failed");
  });
  it("同期falseも取消として扱う", async () => {
    const result = setup(() => false);
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "タブを閉じる" })); });
    expect(result.onResult).not.toHaveBeenCalled(); expect(result.onError).not.toHaveBeenCalled();
  });
});
