import { beforeEach, describe, expect, it, vi } from "vitest";
import { stageDocumentAsset } from "./commands";
import { parseRasterDataUri, imageOccurrenceWithSource } from "./assetConversion";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { planOccurrenceConversion } from "./immediateMarkdownMutation";
import { referencedStagedAssetIds } from "./clipboardImage";
import { resolveOperationTarget } from "../features/codex/scope";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const image = (content: string) => {
  const occurrence = collectEditableMarkdownOccurrences(content)[0];
  if (occurrence?.kind !== "image") throw new Error("画像出現が必要");
  return occurrence;
};

beforeEach(() => { invoke.mockReset(); });

describe("B02-M08追補: 実stage応答の最小DTOから未保存画像を往復変換", () => {
  it("PNGをファイル化して未保存のまま戻してもMIME・画像対象・本文を保持し中間PNGを保存しない", async () => {
    const stored = "# 保存済み本文\n";
    const initial = `${stored}\n![未確定](${png})\n\n保存前の追記\n`;
    const parsed = parseRasterDataUri(image(initial).source)!;
    // native M08で実測した応答と同じ。RustはMIME/base64を返さない。
    invoke.mockResolvedValue({ id: "stage-png", filename: "未確定.png" });
    const request = { documentPath: "C:/fixture/M08.md", preferredFilename: "未確定.png", mediaType: parsed.mediaType, base64: parsed.base64 };
    const staged = await stageDocumentAsset(request);
    const filed = planOccurrenceConversion(stored, initial, image(initial), imageOccurrenceWithSource(image(initial), staged.filename));
    expect(filed.stored).toBeNull();
    expect(referencedStagedAssetIds(filed.draft, "C:/fixture", [staged])).toEqual(["stage-png"]);
    expect(staged.previewSource).toBe(png);
    expect(staged.mediaType).toBe("image/png");
    expect(staged.base64).toBe(parsed.base64);

    // Appのpending asset読み戻し契約と同じデータを使い、元のdata URIを直に再利用しない。
    const restoredSource = `data:${staged.mediaType ?? "application/octet-stream"};base64,${staged.base64 ?? ""}`;
    const embedded = planOccurrenceConversion(stored, filed.draft, image(filed.draft), imageOccurrenceWithSource(image(filed.draft), restoredSource));
    expect(embedded).toEqual({ stored: null, draft: initial });
    expect(resolveOperationTarget(embedded.draft, { offset: embedded.draft.indexOf("未確定") })).toMatchObject({ targetKind: "image", storage: "embedded", imageSource: png });
    expect(referencedStagedAssetIds(embedded.draft, "C:/fixture", [staged])).toEqual([]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("stage_document_asset", { request: { documentPath: request.documentPath, preferredFilename: request.preferredFilename, base64: parsed.base64 } });
  });

  it("JPEGの宣言形式をPNGに固定せず保持する（画像復号は実WebViewで別確認）", async () => {
    invoke.mockResolvedValue({ id: "stage-jpeg", filename: "photo.jpg" });
    const request = { documentPath: "C:/fixture/M08.md", preferredFilename: "photo.jpg", mediaType: "image/jpeg", base64: "/9j/2Q==" };
    expect(await stageDocumentAsset(request)).toMatchObject({ mediaType: "image/jpeg", base64: request.base64, previewSource: `data:image/jpeg;base64,${request.base64}` });
  });

  it("テキストstageは画像MIMEを補わず本文を保持する", async () => {
    invoke.mockResolvedValue({ id: "stage-code", filename: "code/main.py" });
    const request = { documentPath: "C:/fixture/M08.md", preferredFilename: "main.py", text: 'print("保存前")\n' };
    const staged = await stageDocumentAsset(request);
    expect(staged).toEqual({ id: "stage-code", filename: "code/main.py", text: request.text });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("stage_document_asset", { request });
  });

  it("stage失敗は候補を返さず元のエラーを呼出し元へ返す", async () => {
    invoke.mockRejectedValue(new Error("試験用stage失敗"));
    const parsed = parseRasterDataUri(png)!;
    const request = { documentPath: "C:/fixture/M08.md", preferredFilename: "new.png", mediaType: parsed.mediaType, base64: parsed.base64 };
    await expect(stageDocumentAsset(request)).rejects.toThrow("試験用stage失敗");
  });
});
