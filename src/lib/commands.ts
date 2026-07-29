import { invoke } from "@tauri-apps/api/core";
import { CropImageRequest, CropImageResult, MarkdownLoadResult } from "../types/app";

export interface CorruptFileInfo {
  sourcePath: string;
  backupPath: string;
}

export interface SettingsLoadStatus {
  settings: Record<string, unknown>;
  recoveredFiles: CorruptFileInfo[];
}

export async function loadSettings(): Promise<Record<string, unknown>> { return await invoke<Record<string, unknown>>("load_settings"); }
export async function loadSettingsStatus(): Promise<SettingsLoadStatus> { return await invoke<SettingsLoadStatus>("load_settings_status"); }
export async function saveSettings(updates: Record<string, unknown>): Promise<Record<string, unknown>> { return await invoke<Record<string, unknown>>("save_settings", { updates }); }
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
export async function openInNewWindow(path: string): Promise<void> { await invoke<void>("open_in_new_window", { path }); }

export async function loadMarkdown(path: string): Promise<MarkdownLoadResult> {
  return await invoke<MarkdownLoadResult>("load_markdown", { path });
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
