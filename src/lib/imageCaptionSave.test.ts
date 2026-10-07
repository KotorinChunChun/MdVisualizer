import { describe, expect, it, vi } from "vitest";
import { createImageCaptionSaver } from "./imageCaptionSave";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { imageOccurrenceWithCaption } from "./assetConversion";
import type { MediaPreviewTarget } from "../components/MediaPreviewModal";
import { initialTabsState, tabsReducer, type TabsAction } from "../state/tabsReducer";
import type { MarkdownLoadResult } from "../types/app";

const source = '![左](same.png "L") ![中央](same.png "C") ![右](same.png "R")';
function doc(content: string): MarkdownLoadResult { return { path: "C:/b03/caption.md", kind: "markdown", content, base_dir: "C:/b03", image_paths: [], encoding: "UTF-8", size_bytes: content.length, modified_at: "now", revision: content }; }
function setup() {
  let stored = source;
  let state = tabsReducer(initialTabsState, { type: "OPEN", path: doc(source).path });
  const id = state.activeId!;
  const dispatch = (action: TabsAction) => { state = tabsReducer(state, action); };
  dispatch({ type: "LOADED", id, generation: 1, document: doc(source) });
  const occurrence = collectEditableMarkdownOccurrences(source)[1];
  if (occurrence.kind !== "image") throw new Error("fixture");
  const context = { markdownPath: doc(source).path, imagePath: "C:/b03/same.png", source: "same.png", sourceOffset: occurrence.start, caption: occurrence.caption };
  let preview: MediaPreviewTarget | null = { content: { kind: "image", src: "asset://same.png", alt: occurrence.caption }, imageContext: context,
    conversionContext: { documentPath: context.markdownPath, occurrence, storage: "external", assetKind: "raster" } };
  const save = vi.fn(async ({ caption }: { caption: string }) => { stored = source.replace(occurrence.expected, imageOccurrenceWithCaption(occurrence, caption)); });
  const load = vi.fn(async () => doc(stored));
  const persist = createImageCaptionSaver({ getTabs: () => state.tabs, getPreview: () => preview, setPreview: next => { preview = next; }, dispatch, save, load });
  return { id, context, save, load, dispatch, persist, preview: () => preview, setPreview: (value: MediaPreviewTarget | null) => { preview = value; }, tab: () => state.tabs.find(tab => tab.id === id)!, stored: () => stored };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe("画像情報の保存済本文とプレビュー所有", () => {
  it("同じ画像3配置の中央を保存し、実本文由来caption・title・変換出現・タブを同時更新する", async () => {
    const s = setup(); await s.persist(s.context, "左 | 右");
    expect(s.tab().draft).toBe(s.stored()); expect(s.tab().dirty).toBe(false);
    expect(s.preview()?.conversionContext?.occurrence.expected).toBe('![左 \\| 右](same.png "C")');
    expect(s.preview()?.imageContext?.caption).toBe("左 | 右");
    expect(s.preview()?.content.alt).toBe("左 | 右");
    expect(s.stored()).toContain('![左](same.png "L")'); expect(s.stored()).toContain('![右](same.png "R")');
  });
  it("保存拒否では本文・caption・変換出現を保ち再操作できる", async () => {
    const s = setup(); s.save.mockRejectedValueOnce(new Error("書込み拒否"));
    await expect(s.persist(s.context, "新")).rejects.toThrow("書込み拒否");
    expect(s.tab().draft).toBe(source); expect(s.stored()).toBe(source); expect(s.preview()?.imageContextStale).toBe(false);
    await s.persist(s.context, "新"); expect(s.save).toHaveBeenCalledTimes(2); expect(s.preview()?.imageContext?.caption).toBe("新");
  });
  it("保存済みの再読込失敗は明示し、同じcaptionの再試行では再保存せず取得だけ行う", async () => {
    const s = setup(); s.load.mockRejectedValueOnce(new Error("読込み拒否"));
    await expect(s.persist(s.context, "新")).rejects.toThrow("キャプションは保存済み");
    expect(s.preview()?.imageContextStale).toBe(true); expect(s.preview()?.imageContext?.caption).toBe("中央");
    expect(s.stored()).not.toBe(source); expect(s.tab().draft).toBe(source);
    await s.persist(s.context, "新"); expect(s.save).toHaveBeenCalledOnce(); expect(s.load).toHaveBeenCalledTimes(2);
    expect(s.preview()?.imageContextStale).toBe(false); expect(s.tab().draft).toBe(s.stored());
  });
  it.each(["別画像", "閉じる"])("保存中に%sへ移っても遅い結果を新プレビューへ反映しない", async kind => {
    const s = setup(); const gate = deferred<void>(); s.save.mockImplementationOnce(async () => { await gate.promise; });
    const pending = s.persist(s.context, "新");
    const other: MediaPreviewTarget | null = kind === "閉じる" ? null : { content: { kind: "image", src: "asset://other.png", alt: "別画像" }, imageContext: { ...s.context, source: "other.png", caption: "別画像" } };
    s.setPreview(other); gate.resolve(); await pending; expect(s.preview()).toBe(other);
  });
  it("保存待ちの二重要求は拒否し1回だけ書き込む", async () => {
    const s = setup(); const gate = deferred<void>(); s.save.mockImplementationOnce(() => gate.promise);
    const first = s.persist(s.context, "新"); await expect(s.persist(s.context, "新2")).rejects.toThrow("保存中");
    gate.resolve(); await first; expect(s.save).toHaveBeenCalledOnce();
  });
  it("保存待ちに追加された入力は読み直しで消さない", async () => {
    const s = setup(); const gate = deferred<MarkdownLoadResult>(); s.load.mockImplementationOnce(() => gate.promise);
    const pending = s.persist(s.context, "新"); await vi.waitFor(() => expect(s.load).toHaveBeenCalledOnce());
    s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: `${source}\n追加入力` }); gate.resolve(doc(s.stored())); await pending;
    expect(s.tab().draft).toBe(`${source}\n追加入力`); expect(s.tab().dirty).toBe(true); expect(s.tab().storageDocument?.content).toBe(s.stored());
  });
  it("未保存または保存中の本文に画像情報を即時保存しない", async () => {
    const s = setup(); s.dispatch({ type: "DRAFT_CHANGED", id: s.id, content: source + "追記" });
    await expect(s.persist(s.context, "新")).rejects.toThrow("先に文書を保存"); expect(s.save).not.toHaveBeenCalled();
  });
  it("読込み時に出現位置が変わった場合、同じ参照先の隣の画像へ推測反映しない", async () => {
    const s = setup(); s.load.mockResolvedValueOnce(doc(`追記\n${source}`));
    await expect(s.persist(s.context, "新")).rejects.toThrow("画像の位置");
    expect(s.preview()?.imageContextStale).toBe(true); expect(s.preview()?.imageContext?.caption).toBe("中央");
  });
});
