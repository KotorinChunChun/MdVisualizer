import type { MediaPreviewTarget } from "../components/MediaPreviewModal";
import type { TabState } from "../state/tabsReducer";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { documentSourceIdentity } from "./pathIdentity";

/** 表示履歴は本文の旧コピーを持つため、戻る時点の文書へ操作対象を結び直す。 */
export function restoreNavigationMediaPreview(
  target: MediaPreviewTarget | null,
  tab?: Pick<TabState, "path" | "document" | "draft">,
): { preview: MediaPreviewTarget | null; changedTarget: boolean } {
  if (!target || target.content.kind !== "image" || (!target.imageContext && !target.conversionContext)) {
    return { preview: target, changedTarget: false };
  }
  const context = target.imageContext;
  const conversion = target.conversionContext;
  const documentPath = context?.markdownPath ?? conversion!.documentPath;
  const offset = context?.sourceOffset ?? conversion!.occurrence.start;
  const source = context?.source ?? (conversion!.occurrence.kind === "image" ? conversion!.occurrence.source : null);
  const identity = documentSourceIdentity(documentPath);
  if (!tab?.document || tab.document.kind !== "markdown" || documentSourceIdentity(tab.path) !== identity
    || documentSourceIdentity(tab.document.path) !== identity
    || (conversion && documentSourceIdentity(conversion.documentPath) !== identity)) {
    return { preview: null, changedTarget: true };
  }
  const occurrence = collectEditableMarkdownOccurrences(tab.draft)
    .find(item => item.kind === "image" && item.start === offset && item.source === source);
  if (occurrence?.kind !== "image") return { preview: null, changedTarget: true };
  const conversionContext = conversion ? { ...conversion, occurrence } : undefined;
  return {
    changedTarget: false,
    preview: {
      ...target,
      content: { ...target.content, alt: occurrence.caption },
      headingTitle: occurrence.caption.trim() || undefined,
      imageContext: context ? { ...context, caption: occurrence.caption } : undefined,
      imageContextStale: false,
      conversionContext,
      editTarget: target.editTarget ? { ...target.editTarget, conversionContext } : target.editTarget,
    },
  };
}
