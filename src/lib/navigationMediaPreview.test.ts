import { describe, expect, it } from "vitest";
import { restoreNavigationMediaPreview } from "./navigationMediaPreview";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import type { MediaPreviewTarget } from "../components/MediaPreviewModal";
import type { TabState } from "../state/tabsReducer";

const before = '![以前の説明](assets/original.png "固定title")\n\n![別の説明](assets/original.png)';
const after = before.replace("以前の説明", "保存後の説明");
function setup(content = after) {
  const path = "C:/b04/history.md";
  const occurrence = collectEditableMarkdownOccurrences(before)[0];
  if (occurrence.kind !== "image") throw new Error("画像fixtureが必要");
  const conversionContext = { documentPath: path, occurrence, storage: "external" as const, assetKind: "raster" as const };
  const target: MediaPreviewTarget = {
    content: { kind: "image", src: "asset://original.png", alt: occurrence.caption },
    imageContext: { markdownPath: path, imagePath: "C:/b04/assets/original.png", source: occurrence.source, sourceOffset: occurrence.start, caption: occurrence.caption },
    conversionContext,
    editTarget: { rawSrc: occurrence.source, filename: "original.png", storage: "external", conversionContext },
  };
  const tab: Pick<TabState, "path" | "draft" | "document"> = {
    path, draft: content,
    document: { kind: "markdown", path, content, base_dir: "C:/b04", image_paths: [], encoding: "UTF-8", size_bytes: content.length, modified_at: "now", revision: "saved" },
  };
  return { target, tab };
}

describe("B04-M05 表示履歴の画像を現在の文書に照合", () => {
  it("保存後の説明とコピー/変換記法を揃え、別出現や履歴内の旧objectを書き換えない", () => {
    const { target, tab } = setup();
    const result = restoreNavigationMediaPreview(target, tab);
    expect(result.changedTarget).toBe(false);
    expect(result.preview?.content.alt).toBe("保存後の説明");
    expect(result.preview?.imageContext?.caption).toBe("保存後の説明");
    expect(result.preview?.conversionContext?.occurrence.expected).toBe(after.split("\n")[0]);
    expect(result.preview?.editTarget?.conversionContext).toBe(result.preview?.conversionContext);
    expect(target.content.alt).toBe("以前の説明");
    expect(tab.draft).toBe(after);
  });
  it.each(["移動", "参照変更", "閉じたtab", "別文書"])("%sで元の対象を同定できなければ古い操作を復元しない", change => {
    const { target, tab } = setup();
    if (change === "移動") tab.draft = "追記\n" + after;
    if (change === "参照変更") tab.draft = after.replace("assets/original.png", "assets/other.png");
    if (change === "別文書") tab.path = "C:/b04/other.md";
    expect(restoreNavigationMediaPreview(target, change === "閉じたtab" ? undefined : tab)).toEqual({ preview: null, changedTarget: true });
  });
  it("未保存の説明・空欄も現在本文に合わせ、拡張パス表記差は同じ文書として扱う", () => {
    const { target, tab } = setup();
    tab.path = "\\\\?\\C:\\b04\\history.md";
    tab.draft = after.replace("保存後の説明", "");
    const result = restoreNavigationMediaPreview(target, tab);
    expect(result.changedTarget).toBe(false);
    expect(result.preview?.content.alt).toBe("");
    expect(result.preview?.headingTitle).toBeUndefined();
    expect(result.preview?.conversionContext?.occurrence.expected).toBe('![](assets/original.png "固定title")');
  });
  it("画像情報を持たない変換対象からも更新し、図など非対象はそのまま復元する", () => {
    const { target, tab } = setup();
    delete target.imageContext;
    expect(restoreNavigationMediaPreview(target, tab).preview?.content.alt).toBe("保存後の説明");
    const diagram: MediaPreviewTarget = { content: { kind: "svg", svg: "<svg/>", alt: "図" } };
    expect(restoreNavigationMediaPreview(diagram).preview).toBe(diagram);
    expect(restoreNavigationMediaPreview(null)).toEqual({ preview: null, changedTarget: false });
  });
  it("埋込画像ではdata URIを維持して現在の説明へ更新する", () => {
    const { target, tab } = setup();
    const source = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const content = `![以前の説明](${source})`;
    const occurrence = collectEditableMarkdownOccurrences(content)[0];
    if (occurrence.kind !== "image") throw new Error("画像fixtureが必要");
    delete target.imageContext;
    target.content = { kind: "image", src: source, alt: "以前の説明" };
    target.conversionContext = { documentPath: tab.path, occurrence, storage: "embedded", assetKind: "raster" };
    tab.draft = content.replace("以前の説明", "埋込の新しい説明");
    const result = restoreNavigationMediaPreview(target, tab);
    expect(result.preview?.content).toEqual({ kind: "image", src: source, alt: "埋込の新しい説明" });
    expect(result.preview?.conversionContext?.occurrence.expected).toBe(tab.draft);
  });
});
