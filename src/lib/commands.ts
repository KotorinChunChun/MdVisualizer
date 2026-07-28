import { invoke } from "@tauri-apps/api/core";
import { CropImageRequest, CropImageResult, MarkdownLoadResult } from "../types/app";

export async function getInitialFiles(): Promise<string[]> {
  return await invoke<string[]>("get_initial_files");
}

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

export async function restoreImage(path: string): Promise<boolean> {
  return await invoke<boolean>("restore_image", { path });
}

export async function openExternalEditor(path: string): Promise<void> {
  return await invoke<void>("open_external_editor", { path });
}
