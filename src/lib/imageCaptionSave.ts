import type { ImageEditContext, MediaPreviewTarget } from "../components/MediaPreviewModal";
import type { TabState, TabsAction } from "../state/tabsReducer";
import type { MarkdownLoadResult } from "../types/app";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { localPathIdentity } from "./pathIdentity";

/** 保存済本文を出現情報の正本とする。読込みだけ失敗した再試行では二重保存しない。 */
export function createImageCaptionSaver({ getTabs, getPreview, setPreview, dispatch, save, load }: {
  getTabs: () => TabState[];
  getPreview: () => MediaPreviewTarget | null;
  setPreview: (preview: MediaPreviewTarget) => void;
  dispatch: (action: TabsAction) => void;
  save: (request: { markdownPath: string; sourceOffset: number; expectedSource: string; caption: string }) => Promise<void>;
  load: (path: string) => Promise<MarkdownLoadResult>;
}) {
  const pendingRefresh = new WeakMap<ImageEditContext, string>();
  const busy = new Set<string>();
  let requestSequence = 0;
  return async (context: ImageEditContext, caption: string): Promise<void> => {
    const identity = localPathIdentity(context.markdownPath);
    const tabs = getTabs().filter(tab => localPathIdentity(tab.path) === identity);
    if (tabs.some(tab => tab.dirty || tab.saving)) throw new Error("未保存のMarkdown編集があります。先に文書を保存してから画像情報を変更してください。");
    let owner = getPreview();
    if (!owner || owner.imageContext !== context) throw new Error("画像の表示対象が変更されました。画像情報を開き直してください。");
    if (busy.has(identity)) throw new Error("画像情報を保存中です。完了してから再試行してください。");
    busy.add(identity);
    const updateOwner = (next: MediaPreviewTarget) => {
      if (getPreview() !== owner) return;
      owner = next;
      setPreview(next);
    };
    updateOwner({ ...owner, imageContextStale: true });
    try {
      if (pendingRefresh.get(context) !== caption) {
        try { await save({ markdownPath: context.markdownPath, sourceOffset: context.sourceOffset, expectedSource: context.source, caption }); }
        catch (error) { updateOwner({ ...owner!, imageContextStale: pendingRefresh.has(context) }); throw error; }
        pendingRefresh.set(context, caption);
      }
      // 通常のストレージ監視と重ならない負の要求番号を用い、開始時の入力世代を保つ。
      const request = --requestSequence;
      const owners = tabs.filter(tab => getTabs().some(current => current.id === tab.id && current.generation === tab.generation));
      owners.forEach(tab => dispatch({ type: "STORAGE_REQUESTED", id: tab.id, request }));
      try {
        const document = await load(context.markdownPath);
        if (document.kind !== "markdown" || localPathIdentity(document.path) !== identity) throw new Error("対象のMarkdownを取得できませんでした。");
        owners.forEach(tab => dispatch({ type: "STORAGE_LOADED", id: tab.id, request, generation: tab.generation,
          changeSequence: tab.changeSequence ?? 0, reloadIfClean: true, document }));
        const occurrence = collectEditableMarkdownOccurrences(document.content).find(item => item.kind === "image"
          && item.start === context.sourceOffset && item.source === context.source);
        if (occurrence?.kind !== "image") throw new Error("保存後の画像の位置が変更されています。画像を開き直してください。");
        const conversionContext = owner!.conversionContext ? { ...owner!.conversionContext, occurrence } : undefined;
        updateOwner({ ...owner!, content: { ...owner!.content, alt: occurrence.caption }, headingTitle: occurrence.caption.trim() || undefined,
          imageContext: { ...context, caption: occurrence.caption }, imageContextStale: false, conversionContext,
          editTarget: owner!.editTarget ? { ...owner!.editTarget, conversionContext } : owner!.editTarget });
        pendingRefresh.delete(context);
      } catch (error) {
        owners.forEach(tab => dispatch({ type: "STORAGE_FAILED", id: tab.id, request, generation: tab.generation, error: String(error) }));
        throw new Error(`キャプションは保存済みですが、画像情報を再取得できませんでした。保存を再試行すると再取得します。${String(error)}`);
      }
    } finally { busy.delete(identity); }
  };
}
