import { describe, expect, it, vi } from "vitest";
import type { MarkdownLoadResult, StagedDocumentAsset, ToastState } from "../types/app";
import { createFenceStorageConverter, type OccurrenceConversionCommit } from "./fenceStorageConversion";
import { collectEditableMarkdownOccurrences, type CodeFenceOccurrence, type ImageMarkdownOccurrence } from "./markdownOccurrences";

type Request = Parameters<ReturnType<typeof createFenceStorageConverter>>[0];
const formats = ["drawio", "mermaid", "table", "text"] as const;
function fixture(format: typeof formats[number], storage: "embedded" | "external" = "embedded") {
  const content = storage === "embedded" ? '```text title="資料"\noriginal\n```' : "![説明](assets/original.txt)";
  const occurrence = collectEditableMarkdownOccurrences(content)[0];
  const document: MarkdownLoadResult = { path: "C:/docs/test.md", kind: "markdown", content, base_dir: "C:/docs", image_paths: [], encoding: "utf-8", size_bytes: content.length, modified_at: "", revision: "r1" };
  const common = { documentPath: document.path, source: "original", relativePath: "assets/資料", alt: "説明" };
  const context = storage === "embedded"
    ? { ...common, storage, occurrence: occurrence as CodeFenceOccurrence }
    : { ...common, storage, occurrence: occurrence as ImageMarkdownOccurrence };
  const request: Request = format === "table" ? { format, context: { ...context, language: "csv" } }
    : format === "text" ? { format, context: { ...context, language: "typescript" } } : { format, context };
  const prepared = { tab: { id: "tab", draft: content, document }, latest: document };
  const stage = vi.fn(async (): Promise<StagedDocumentAsset | null> => ({ id: "asset", filename: "assets/result.txt" }));
  const prepare = vi.fn(async (): Promise<typeof prepared | null> => prepared);
  const read = vi.fn(async (): Promise<{ filename: string; text: string | null; revision: string }> => ({ filename: "original.txt", text: "updated", revision: "asset-r1" }));
  const ports = {
    confirm: vi.fn(async () => true), prepare, stage, read,
    commit: vi.fn(async (_request: OccurrenceConversionCommit) => document), discard: vi.fn(async () => {}),
    notify: vi.fn<(toast: ToastState) => void>(), openFolder: vi.fn(async () => {}), deleteExternal: vi.fn(async () => {}),
    embeddedPathStyle: "fence-title" as const,
  };
  return { request, ports, prepared, convert: createFenceStorageConverter(ports) };
}

describe("コードフェンスの格納形態変換", () => {
  it.each([
    ["drawio", "drawio", "![説明](assets/result.txt)"],
    ["mermaid", "mmd", "![説明](assets/result.txt)"],
    ["table", "csv", "![CSV表](assets/result.txt)"],
    ["text", "ts", "![result.txt](assets/result.txt)"],
  ] as const)("%sをファイルへ変換し、元本文と保存revisionを維持する", async (format, extension, replacement) => {
    const { convert, request, ports, prepared } = fixture(format);
    await convert(request);
    expect(ports.stage).toHaveBeenCalledWith(expect.objectContaining({ preferredFilename: `assets-資料.${extension}`, preferredSource: `assets/資料.${extension}`, text: "original" }));
    expect(ports.commit).toHaveBeenCalledWith({ tabId: "tab", documentPath: prepared.tab.document.path, draft: prepared.tab.draft, latest: prepared.latest, occurrence: request.context.occurrence, replacement, committedAssetIds: ["asset"] });
    expect(ports.discard).not.toHaveBeenCalled();
    expect(ports.deleteExternal).not.toHaveBeenCalled();
  });

  it.each(formats)("%sの外部ファイルは最新内容を埋め込み、削除は利用者の操作まで待つ", async format => {
    const { convert, request, ports } = fixture(format, "external");
    await convert(request);
    expect(ports.commit).toHaveBeenCalledWith(expect.objectContaining({ replacement: expect.stringContaining("updated"), latest: expect.objectContaining({ revision: "r1" }) }));
    expect(ports.stage).not.toHaveBeenCalled();
    expect(ports.deleteExternal).not.toHaveBeenCalled();
    await ports.notify.mock.calls[0][0].actions![0].onAction();
    expect(ports.deleteExternal).toHaveBeenCalledWith("C:/docs/test.md", "assets/original.txt", "asset-r1");
  });

  it.each(["confirm", "prepare", "stage"] as const)("%sで取り消したら本文を反映しない", async boundary => {
    const { convert, request, ports } = fixture("mermaid");
    if (boundary === "confirm") ports.confirm.mockResolvedValue(false);
    if (boundary === "prepare") ports.prepare.mockResolvedValue(null);
    if (boundary === "stage") ports.stage.mockResolvedValue(null);
    expect(await convert(request)).toBe(false);
    expect(ports.commit).not.toHaveBeenCalled();
    expect(ports.notify).not.toHaveBeenCalled();
    if (boundary !== "stage") expect(ports.stage).not.toHaveBeenCalled();
  });

  it("保存競合では今回の一時ファイルだけ破棄し、成功・削除の操作を出さない", async () => {
    const { convert, request, ports } = fixture("text");
    ports.commit.mockRejectedValue(new Error("保存競合"));
    await expect(convert(request)).rejects.toThrow("保存競合");
    expect(ports.discard).toHaveBeenCalledExactlyOnceWith(["asset"]);
    expect(ports.notify).not.toHaveBeenCalled();
    expect(ports.deleteExternal).not.toHaveBeenCalled();
  });

  it("対象本文が変わっていればステージや保存前に中止する", async () => {
    const { convert, request, ports, prepared } = fixture("drawio");
    prepared.tab.draft = prepared.tab.draft.replace("original", "edited");
    await expect(convert(request)).rejects.toThrow();
    expect(ports.stage).not.toHaveBeenCalled();
    expect(ports.commit).not.toHaveBeenCalled();
  });

  it("対象の前に追記されただけなら移動先の位置を使い追記を保持する", async () => {
    const { convert, request, ports, prepared } = fixture("mermaid");
    prepared.tab.draft = "追記\n\n" + prepared.tab.draft;
    await convert(request);
    expect(ports.commit).toHaveBeenCalledWith(expect.objectContaining({ draft: prepared.tab.draft, occurrence: expect.objectContaining({ start: 4 }) }));
  });

  it.each(formats)("%sの読込失敗では文書や外部ファイルを変更しない", async format => {
    const { convert, request, ports } = fixture(format, "external");
    ports.read.mockRejectedValue(new Error("読込拒否"));
    await expect(convert(request)).rejects.toThrow("読込拒否");
    expect(ports.commit).not.toHaveBeenCalled();
    expect(ports.deleteExternal).not.toHaveBeenCalled();
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it.each(formats)("%sの空本文の扱いを維持する", async format => {
    const { convert, request, ports } = fixture(format, "external");
    ports.read.mockResolvedValue({ filename: "empty", text: "", revision: "r2" });
    if (format === "table" || format === "text") {
      await convert(request);
      expect(ports.commit).toHaveBeenCalledOnce();
    } else {
      await expect(convert(request)).rejects.toThrow("最新内容");
      expect(ports.commit).not.toHaveBeenCalled();
    }
  });

  it.each(["table", "text"] as const)("%sのBOMと末尾空行を除去し、文書のCRLFへ合わせる", async format => {
    const { convert, request, ports, prepared } = fixture(format, "external");
    prepared.latest.content += "\r\n";
    ports.read.mockResolvedValue({ filename: "original.txt", text: "\uFEFFa,b\r\n\r\n", revision: "r2" });
    await convert(request);
    const replacement = ports.commit.mock.calls[0][0].replacement;
    expect(replacement).not.toContain("\uFEFF");
    expect(replacement).toContain("a,b\r\n```");
    expect(replacement.replace(/\r\n/g, "")).not.toContain("\n");
  });
});
