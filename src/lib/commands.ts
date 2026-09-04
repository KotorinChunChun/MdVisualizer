import { invoke } from "@tauri-apps/api/core";
import { CreateMarkdownRequest, CropImageRequest, CropImageResult, MarkdownLoadResult, MarkdownSaveResult, SaveMarkdownRequest } from "../types/app";
import type { DiagnosticItem } from "../components/DiagnosticsPanel";
import type { DebugWindowState } from "./debugState";

export interface CorruptFileInfo {
  sourcePath: string;
  backupPath: string;
}

export interface SettingsLoadStatus {
  settings: Record<string, unknown>;
  recoveredFiles: CorruptFileInfo[];
}

export interface MarkdownStyleFile {
  css: string;
  path: string;
  revision: string;
}

export async function loadSettings(): Promise<Record<string, unknown>> { return await invoke<Record<string, unknown>>("load_settings"); }
export async function loadSettingsStatus(): Promise<SettingsLoadStatus> { return await invoke<SettingsLoadStatus>("load_settings_status"); }
export async function saveSettings(updates: Record<string, unknown>): Promise<Record<string, unknown>> { return await invoke<Record<string, unknown>>("save_settings", { updates }); }
export async function loadMarkdownStyle(defaultCss: string): Promise<MarkdownStyleFile> { return await invoke<MarkdownStyleFile>("load_markdown_style", { defaultCss }); }
export async function saveMarkdownStyle(css: string): Promise<MarkdownStyleFile> { return await invoke<MarkdownStyleFile>("save_markdown_style", { css }); }
export async function openMarkdownStyle(): Promise<void> { await invoke<void>("open_markdown_style"); }
export async function copyMermaidFile(request: { kind: "code" | "png" | "bmp" | "svg"; diagramKind: "mermaid" | "drawio"; source: string; svg: string; pngBytes: number[] }): Promise<string> {
  return await invoke<string>("copy_mermaid_file", { request });
}
export async function copyBmpToClipboard(bytes: number[]): Promise<void> {
  await invoke<void>("copy_bmp_to_clipboard", { bytes });
}
export async function copyTextFile(request: { filename: string; content: string; utf8Bom?: boolean }): Promise<string> {
  return await invoke<string>("copy_text_file", { request });
}
export async function updateExternalAppSettings(
  upserts: unknown[],
  removedIds: string[],
  presentationLineThreshold: number,
  imageA4TargetWidth: number,
  imageEqualPadding: number,
): Promise<Record<string, unknown>> {
  return await invoke<Record<string, unknown>>("update_external_app_settings", {
    upserts,
    removedIds,
    presentationLineThreshold,
    imageA4TargetWidth,
    imageEqualPadding,
  });
}
export async function saveFoldState(documentPath: string, state: Record<string, boolean>): Promise<Record<string, unknown>> { return await invoke<Record<string, unknown>>("save_fold_state", { documentPath, state }); }

export async function getInitialFiles(): Promise<string[]> {
  return await invoke<string[]>("get_initial_files");
}
export async function reportDebugWindowState(snapshot: DebugWindowState): Promise<void> {
  await invoke<void>("report_debug_window_state", { snapshot });
}
export async function openInNewWindow(path: string): Promise<void> { await invoke<void>("open_in_new_window", { path }); }

export async function loadMarkdown(path: string): Promise<MarkdownLoadResult> {
  return await invoke<MarkdownLoadResult>("load_markdown", { path });
}
export async function saveMarkdown(request: SaveMarkdownRequest): Promise<MarkdownSaveResult> {
  return await invoke<MarkdownSaveResult>("save_markdown", { request });
}
export async function saveTableCsv(path: string, content: string): Promise<string> {
  return await invoke<string>("save_table_csv", { path, content });
}
export async function createMarkdown(request: CreateMarkdownRequest): Promise<MarkdownLoadResult> {
  return await invoke<MarkdownLoadResult>("create_markdown", { request });
}
export async function stageDocumentAsset(request: { documentPath: string; preferredFilename: string; preferredSource?: string; base64?: string; text?: string }): Promise<import("../types/app").StagedDocumentAsset> {
  return await invoke("stage_document_asset", { request });
}
export async function updateStagedTextAsset(id: string, text: string): Promise<void> {
  await invoke("update_staged_text_asset", { id, text });
}
export async function stageClipboardImage(request: { documentPath: string; preferredFilename: string; base64: string; destination: import("../types/settings").ClipboardImagePngLocation; absoluteDirectory?: string }): Promise<import("../types/app").StagedDocumentAsset> {
  return await invoke("stage_clipboard_image", { request });
}
export async function discardStagedAssets(ids: string[]): Promise<void> { await invoke("discard_staged_assets", { ids }); }
export async function readDocumentAsset(documentPath: string, source: string): Promise<import("../types/app").DocumentAssetData> {
  return await invoke("read_document_asset", { documentPath, source });
}
export async function deleteDocumentAsset(request: { documentPath: string; source: string; expectedRevision?: string }): Promise<void> {
  await invoke<void>("delete_document_asset", { request });
}
export async function saveSharePointAsset(request: import("../types/app").SharePointAssetSaveRequest): Promise<import("../types/app").SharePointAssetSaveResult> {
  return await invoke("save_sharepoint_asset", { request });
}
export async function diagnoseDocument(path: string): Promise<DiagnosticItem[]> {
  return await invoke<DiagnosticItem[]>("diagnose_document", { path });
}
export async function documentWatchTargets(path: string): Promise<string[]> {
  return await invoke<string[]>("document_watch_targets", { path });
}

export async function startWatch(path: string): Promise<void> {
  return await invoke<void>("start_watch", { path });
}

export async function stopWatch(): Promise<void> {
  return await invoke<void>("stop_watch");
}

export async function syncWatchTargets(windowLabel: string, targets: string[]): Promise<void> {
  await invoke<void>("sync_watch_targets", { windowLabel, targets });
}

export async function removeWindowWatchTargets(windowLabel: string): Promise<void> {
  await invoke<void>("remove_window_watch_targets", { windowLabel });
}

export async function cropImage(request: CropImageRequest): Promise<CropImageResult> {
  return await invoke<CropImageResult>("crop_image", { request });
}

export async function saveRenderedImage(request: {
  path: string;
  pngBytes: number[];
  expectedSourceWidth: number;
  expectedSourceHeight: number;
}): Promise<CropImageResult> {
  return await invoke<CropImageResult>("save_rendered_image", { request });
}

export async function restoreImage(path: string): Promise<boolean> {
  return await invoke<boolean>("restore_image", { path });
}

export async function hasImageBackup(path: string): Promise<boolean> {
  return await invoke<boolean>("has_image_backup", { path });
}

export async function updateImageCaption(request: {
  markdownPath: string;
  sourceOffset: number;
  expectedSource: string;
  caption: string;
}): Promise<void> {
  await invoke<void>("update_image_caption", { request });
}

export interface RenameImageReferencesResult {
  oldPath: string;
  newPath: string;
  updatedDocuments: string[];
  updatedReferences: number;
}

export async function renameImageAndReferences(request: {
  markdownPath: string;
  imagePath: string;
  newFilename: string;
  overwrite?: boolean;
}): Promise<RenameImageReferencesResult> {
  return await invoke<RenameImageReferencesResult>("rename_image_and_references", { request });
}

export async function openExternalEditor(path: string): Promise<void> {
  return await invoke<void>("open_external_editor", { path });
}
export async function openContainingFolder(path: string): Promise<void> { await invoke<void>("open_containing_folder", { path }); }
export async function openInEditor(path: string, editor: "vscode" | "notepad"): Promise<void> { await invoke<void>("open_in_editor", { path, editor }); }
export async function openExternalUrl(url: string): Promise<void> { await invoke<void>("open_external_url", { url }); }
export async function openExternalApp(request: {
  executable: string;
  args: string[];
  workingDirectory?: string;
  file: string;
  line?: number;
}): Promise<void> {
  await invoke<void>("open_external_app", { request });
}

export interface PowerShellRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export async function runPowerShell(request: { documentPath: string; language: string; source: string }): Promise<PowerShellRunResult> {
  return await invoke<PowerShellRunResult>("run_powershell", { request });
}
