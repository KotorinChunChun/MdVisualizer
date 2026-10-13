import type { MarkdownLoadResult, StagedDocumentAsset, ToastState } from "../types/app";
import type { EmbeddedPathStyle } from "../types/settings";
import { normalizedAssetFilename } from "./assetConversion";
import { drawioExternalReference, markdownLineEnding, type DrawioStorageConversionContext } from "./drawioStorage";
import { appendFilenameExtension, embeddedFenceWithPath, markdownContinuationPrefix, normalizeRelativeAssetPath, removeFilenameExtension } from "./externalPathRepresentation";
import { relocateUnchangedOccurrence } from "./immediateMarkdownMutation";
import { codeFenceTitle, type EditableMarkdownOccurrence } from "./markdownOccurrences";
import { mermaidExternalReference, type MermaidStorageConversionContext } from "./mermaidStorage";
import type { TableStorageConversionContext } from "./tableStorage";
import { sourceExtensionForLanguage, textExternalReference, type TextStorageConversionContext } from "./textStorage";

type ConversionRequest =
  | { format: "drawio"; context: DrawioStorageConversionContext }
  | { format: "mermaid"; context: MermaidStorageConversionContext }
  | { format: "table"; context: TableStorageConversionContext }
  | { format: "text"; context: TextStorageConversionContext };

export interface OccurrenceConversionCommit {
  tabId: string;
  documentPath: string;
  draft: string;
  latest: MarkdownLoadResult;
  occurrence: EditableMarkdownOccurrence;
  replacement: string;
  committedAssetIds?: string[];
}

interface ConversionPorts {
  confirm: (context: ConversionRequest["context"]) => Promise<boolean>;
  prepare: (path: string) => Promise<{
    tab: { id: string; draft: string; document: MarkdownLoadResult };
    latest: MarkdownLoadResult;
  } | null>;
  stage: (request: { documentPath: string; preferredFilename: string; preferredSource?: string; text: string }) => Promise<StagedDocumentAsset | null>;
  read: (path: string, source: string) => Promise<{ filename: string; text?: string | null; revision?: string | null }>;
  commit: (request: OccurrenceConversionCommit) => Promise<unknown>;
  discard: (ids: string[]) => Promise<void>;
  notify: (toast: ToastState) => void;
  openFolder: (path: string) => Promise<unknown>;
  deleteExternal: (path: string, source: string, revision?: string) => Promise<void>;
  embeddedPathStyle: EmbeddedPathStyle;
}

/** 形式の差だけを定義する。保存・競合判定は共通のcommitポートへ委ねる。 */
function formatPolicy(request: ConversionRequest) {
  switch (request.format) {
    case "drawio": return {
      language: "drawio", extension: "drawio", fallbackName: "diagram", embeddedLabel: "draw.io", externalLabel: "draw.io",
      readError: "draw.ioファイルの最新内容を読み込めませんでした。", allowEmpty: false, folderLink: true,
      alt: request.context.alt, reference: (filename: string) => drawioExternalReference(filename, request.context.alt),
      body: (text: string) => text,
    };
    case "mermaid": return {
      language: "mermaid", extension: "mmd", fallbackName: "diagram", embeddedLabel: "Mermaid", externalLabel: "Mermaid",
      readError: "Mermaidファイルの最新内容を読み込めませんでした。", allowEmpty: false, folderLink: true,
      alt: request.context.alt, reference: (filename: string) => mermaidExternalReference(filename, request.context.alt),
      body: (text: string) => text,
    };
    case "table": return {
      language: request.context.language, extension: request.context.language.startsWith("csv") ? "csv" : "tsv", fallbackName: "table", embeddedLabel: "表", externalLabel: "表",
      readError: "表ファイルの最新内容を読み込めませんでした。", allowEmpty: true, folderLink: false,
      reference: (filename: string) => `![${request.context.language.toUpperCase()}表](${filename})`,
      body: (text: string) => text.replace(/^\uFEFF/, "").replace(/[\r\n]+$/, ""),
    };
    case "text": return {
      language: request.context.language, extension: sourceExtensionForLanguage(request.context.language), fallbackName: "code", embeddedLabel: "コード", externalLabel: "テキスト",
      readError: "外部テキストの最新内容を読み込めませんでした。", allowEmpty: true, folderLink: false,
      reference: textExternalReference, body: (text: string) => text.replace(/^\uFEFF/, ""),
    };
  }
}

/** 確認・ステージ・本文反映・失敗時破棄を全コードフェンス形式で共有する。 */
export function createFenceStorageConverter(ports: ConversionPorts) {
  const notifySuccess = (message: string, extra: Partial<ToastState> = {}) => ports.notify({
    id: crypto.randomUUID(), message: `${message}未保存の変更は文書の保存で確定します。`, type: "success", ...extra,
  });
  return async (request: ConversionRequest): Promise<false | void> => {
    const { context } = request;
    if (!await ports.confirm(context)) return false;
    const prepared = await ports.prepare(context.documentPath);
    if (!prepared) return false;
    const { tab, latest } = prepared;
    const occurrence = relocateUnchangedOccurrence(tab.draft, context.occurrence);
    const policy = formatPolicy(request);
    const commitBase = { tabId: tab.id, documentPath: tab.document.path, draft: tab.draft, latest, occurrence };

    if (context.storage === "embedded") {
      if (occurrence.kind !== "code-fence") throw new Error(`埋め込み${policy.embeddedLabel}の位置を確認できませんでした。`);
      const staged = await ports.stage({
        documentPath: tab.document.path,
        preferredFilename: normalizedAssetFilename(removeFilenameExtension(context.relativePath ?? codeFenceTitle(occurrence.meta) ?? ""), policy.extension, policy.fallbackName),
        preferredSource: context.relativePath ? appendFilenameExtension(context.relativePath, policy.extension) : undefined,
        text: occurrence.body,
      });
      if (!staged) return false;
      try {
        await ports.commit({ ...commitBase, replacement: policy.reference(staged.filename), committedAssetIds: [staged.id] });
      } catch (error) {
        await ports.discard([staged.id]);
        throw error;
      }
      notifySuccess(`${staged.filename} へ変換しました。`, policy.folderLink ? {
        onMessageClick: async () => {
          try { await ports.openFolder(tab.document.path); }
          catch (error) { ports.notify({ id: crypto.randomUUID(), message: `保存フォルダーを開けませんでした: ${String(error)}`, type: "error" }); }
        },
      } : {});
      return;
    }

    if (occurrence.kind !== "image") throw new Error(`外部${policy.externalLabel}参照の位置を確認できませんでした。`);
    const asset = await ports.read(tab.document.path, occurrence.source);
    if (asset.text == null || (!policy.allowEmpty && !asset.text)) throw new Error(policy.readError);
    await ports.commit({
      ...commitBase,
      replacement: embeddedFenceWithPath({
        language: policy.language,
        body: policy.body(asset.text),
        relativePath: normalizeRelativeAssetPath(occurrence.source) ?? asset.filename,
        alt: policy.alt,
        style: ports.embeddedPathStyle,
        lineEnding: markdownLineEnding(latest.content),
        continuationPrefix: markdownContinuationPrefix(latest.content, occurrence.start),
      }),
    });
    notifySuccess(`${request.format === "text" ? "外部テキスト" : policy.externalLabel}を埋め込みへ切り替えました。`, {
      actions: [{ label: "外部ファイルを削除", onAction: () => ports.deleteExternal(tab.document.path, occurrence.source, asset.revision ?? undefined) }],
    });
  };
}
