import { describe, expect, it, vi } from "vitest";
import { resolveOperationTarget } from "../features/codex/scope";
import { rebaseRenamedExternalReferences } from "./externalFile";
import { imageOccurrenceWithCaption, imageOccurrenceWithSource } from "./assetConversion";
import { collectEditableMarkdownOccurrences, replaceMarkdownOccurrence } from "./markdownOccurrences";
import { analyzeMarkdown } from "./markdownAnalysis";
import { planOccurrenceConversion, relocateUnchangedOccurrence } from "./immediateMarkdownMutation";
import { referencedStagedAssetIds } from "./clipboardImage";
import { saveUntitledDocument } from "./untitledDocument";
import { resolveLocalImagePath, stripWindowsExtendedPathPrefix } from "./path";
import type { MarkdownLoadResult } from "../types/app";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const loaded = (path: string, content: string): MarkdownLoadResult => ({ path, kind: "markdown", content, base_dir: path.slice(0, path.lastIndexOf("/")), image_paths: [], encoding: "UTF-8", size_bytes: content.length, modified_at: "2026-10-08 00:00", revision: "r1", source: "local" });
describe("第2組の自然操作: 格納操作の純粋境界（App/OS接続はnativeで別確認）", () => {
  it.each([
    { raw: "left|right", title: "left|right" },
    { raw: String.raw`left\\|right`, title: String.raw`left\|right` },
    { raw: String.raw`left\\\\|right`, title: String.raw`left\\|right` },
    { raw: String.raw`\"quoted\"\\|尾`, title: String.raw`"quoted"\|尾` },
  ].flatMap(item => ["source", "caption"].map(action => ({ ...item, action }))))("B02-M02追補 表内の参照画像$titleを$action変更してもtitleと列を保持する", ({ raw, title, action }) => {
    const definition = `[photo]: image.png "${raw}"`;
    const markdown = `| 図 | 隣 |\n| --- | --- |\n| ![左][photo] | 左の本文 |\n| ![右][photo] | 右の本文 |\n\n${definition}`;
    const occurrences = collectEditableMarkdownOccurrences(markdown).filter(item => item.kind === "image");
    expect(occurrences).toHaveLength(2); expect(occurrences[1].reference?.title).toBe(title);
    const replacement = action === "source" ? imageOccurrenceWithSource(occurrences[1], "image/after.png") : imageOccurrenceWithCaption(occurrences[1], "新しい説明");
    const changed = replaceMarkdownOccurrence(markdown, occurrences[1], replacement);
    const table = analyzeMarkdown(changed).children.find(node => node.type === "table");
    if (table?.type !== "table") throw new Error("表が消失した");
    expect(table.children.map(row => row.children.length)).toEqual([2, 2, 2]);
    expect(table.children[1].children[0].children[0]).toMatchObject({ type: "imageReference", alt: "左", identifier: "photo" });
    expect(table.children[2].children[0].children[0]).toMatchObject({ type: "image", title, alt: action === "source" ? "右" : "新しい説明", url: action === "source" ? "image/after.png" : "image.png" });
    expect(table.children[1].children[1].children).toEqual([expect.objectContaining({ type: "text", value: "左の本文" })]);
    expect(table.children[2].children[1].children).toEqual([expect.objectContaining({ type: "text", value: "右の本文" })]);
    expect(changed.endsWith(definition)).toBe(true);
  });
  it("B02-M02補助 参照型画像は個別出現へ変換し定義のtitleとfirst-win解決を保つ", () => {
    const markdown = '![左][Photo]\n\n![右][photo]\n\n[photo]: old.png "same title"\n[PHOTO]: ignored.png';
    const occurrences = collectEditableMarkdownOccurrences(markdown).filter(item => item.kind === "image");
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map(item => item.source)).toEqual(["old.png", "old.png"]);
    expect(imageOccurrenceWithSource(occurrences[1], "image/new.png")).toBe('![右](image/new.png "same title")');
    expect(imageOccurrenceWithCaption(occurrences[1], "新 | 右")).toBe('![新 \\| 右](old.png "same title")');
    for (const syntax of ['![photo]', '![photo][]']) {
      const shortcut = collectEditableMarkdownOccurrences(`${syntax}\n\n[photo]: old.png`)[0];
      if (shortcut.kind !== "image") throw new Error("参照画像が未解決");
      expect(imageOccurrenceWithCaption(shortcut, "new caption")).toBe('![new caption](old.png)');
    }
  });
  it("B02-M06 同名別画像を識別し右ファイルの参照だけ改名する", () => {
    const content = "![左](left/photo.png)\n\n![右](right/photo.png)\n\n![左再掲](left/photo.png)";
    const target = resolveOperationTarget(content, { offset: content.indexOf("右") })!;
    expect(target.imageSource).toBe("right/photo.png");
    const renamed = rebaseRenamedExternalReferences(content, "C:/docs", "C:/docs/right/photo.png", "right-renamed.png");
    expect(renamed).toBe("![左](left/photo.png)\n\n![右](right/right-renamed.png)\n\n![左再掲](left/photo.png)");
    expect(stripWindowsExtendedPathPrefix(resolveLocalImagePath("left/photo.png", String.raw`\\?\C:\docs`)!)).toMatch(/C:[\\/]docs[\\/]left[\\/]photo.png$/);
    expect(resolveLocalImagePath("right/right-renamed.png", "C:/docs")).toBe("C:/docs/right/right-renamed.png");
  });
  it("B02-M07 名前付きフェンスのF2対象を抽出し本文の同名文字列は改名しない", () => {
    const content = '```python title="code/sample.py"\nprint("code/sample.py")\n```';
    const target = resolveOperationTarget(content, { offset: content.indexOf("print") })!;
    expect(target).toMatchObject({ targetKind: "code", storage: "embedded", imageSource: "code/sample.py" });
    expect(rebaseRenamedExternalReferences(content, "C:/docs", "C:/docs/code/sample.py", "renamed.py")).toBe('```python title="code/renamed.py"\nprint("code/sample.py")\n```');
    // 実ファイル不存在→作成→再F2の非同期UIは、この純粋関数試験では合格としない。
  });
  it("B02-M08 下書きのファイル化を埋込へ戻すと中間PNGを保存対象にしない", () => {
    const saved = "保存済み本文"; const initial = `${saved}\n\n![図](${png})\n\n未保存の追記`;
    const occurrence = collectEditableMarkdownOccurrences(initial)[0];
    expect(occurrence.kind).toBe("image"); if (occurrence.kind !== "image") throw new Error("fixture不正");
    const staged = planOccurrenceConversion(saved, initial, occurrence, imageOccurrenceWithSource(occurrence, "image/pending.png"));
    expect(staged.stored).toBeNull();
    const next = collectEditableMarkdownOccurrences(staged.draft)[0]; if (next.kind !== "image") throw new Error("変換後の画像なし");
    const embedded = planOccurrenceConversion(saved, staged.draft, next, imageOccurrenceWithSource(next, png));
    expect(embedded).toEqual({ stored: null, draft: initial });
    expect(referencedStagedAssetIds(embedded.draft, "C:/docs", [{ id: "intermediate", filename: "image/pending.png" }])).toEqual([]);
  });
  it("B02-M10 新規MD作成I/O失敗後は最新下書きを別保存先へ渡して再試行する", async () => {
    const initial = `最初の文章\n\n![図](${png})`; const updated = initial + "\n\n失敗後の追記";
    const createDocument = vi.fn().mockRejectedValueOnce(new Error("試験用書込み拒否")).mockImplementationOnce(async (path: string, text: string) => loaded(path, text));
    const choosePath = vi.fn().mockResolvedValueOnce("C:/denied/first.md").mockResolvedValueOnce("C:/allowed/retry.md");
    await expect(saveUntitledDocument({ defaultPath: "無題.md", content: initial, openDocumentPaths: [] }, { choosePath, createDocument })).rejects.toThrow("試験用書込み拒否");
    const retry = await saveUntitledDocument({ defaultPath: "無題.md", content: updated, openDocumentPaths: [] }, { choosePath, createDocument });
    expect(createDocument.mock.calls).toEqual([["C:/denied/first.md", initial], ["C:/allowed/retry.md", updated]]);
    expect(retry).toEqual({ status: "saved", path: "C:/allowed/retry.md", document: loaded("C:/allowed/retry.md", updated) });
  });
  it("B02-M14 遅い変換で変化したA対象は拒否し新しい対象から再操作できる", async () => {
    const openedA = "A文書\n\n![図](same.png)"; const untouchedB = "B文書\n\n![図](same.png)";
    const original = collectEditableMarkdownOccurrences(openedA)[0];
    let finish!: (value: string) => void; const pendingRead = new Promise<string>(resolve => { finish = resolve; });
    const latestA = "A文書\n\n![新しい図](changed.png)\n\n追記";
    finish(png); const replacement = await pendingRead;
    expect(() => relocateUnchangedOccurrence(latestA, original)).toThrow();
    expect(untouchedB).toBe("B文書\n\n![図](same.png)");
    const reselected = collectEditableMarkdownOccurrences(latestA)[0]; if (reselected.kind !== "image") throw new Error("fixture不正");
    expect(planOccurrenceConversion(openedA, latestA, reselected, imageOccurrenceWithSource(reselected, replacement)).draft).toBe(`A文書\n\n![新しい図](${png})\n\n追記`);
    // タブの所有を決めるApp接続はnativeで別確認。B不変の上記assertだけでその接続は実証しない。
  });
});
