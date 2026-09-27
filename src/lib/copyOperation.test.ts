import { afterEach, expect, it, vi } from "vitest";
import { copyWithFeedback, copyTextWithFeedback } from "./copyOperation";
afterEach(() => vi.restoreAllMocks());
const feedback = { success: "コピーしました", failure: "コピーできませんでした" };
it("処理完了を待って成功を一度だけ通知し追加操作を保持", async () => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  let resolve!: () => void;
  const actions = [{ label: "ファイル", onAction: vi.fn() }];
  const copying = copyWithFeedback(() => new Promise<void>(done => { resolve = done; }), { ...feedback, actions });
  expect(dispatch).not.toHaveBeenCalled();
  resolve();
  expect(await copying).toBe(true);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ detail: { type: "success", message: feedback.success, actions } }));
});
it.each([false, true])("同期例外／非同期拒否は失敗だけを通知: %s", async sync => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  expect(await copyWithFeedback(() => { if (sync) throw Error("失敗"); return Promise.reject(Error("失敗")); }, feedback)).toBe(false);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ detail: { type: "error", message: feedback.failure } }));
});
it("実際のクリップボード処理と連続コピーの各通知を保持", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const dispatch = vi.spyOn(window, "dispatchEvent");
  await copyTextWithFeedback("値", feedback);
  await copyTextWithFeedback("値", feedback);
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText).toHaveBeenCalledWith("値");
  expect(dispatch).toHaveBeenCalledTimes(2);
});
it("ホストのダウンロード結果を成功文言へ渡す", async () => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  await copyWithFeedback(() => Promise.resolve("download"), { ...feedback, success: result => result === "download" ? "保存しました" : "コピーしました" });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ type: "success", message: "保存しました" }) }));
});
