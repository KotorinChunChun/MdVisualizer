use crate::app_state::AppState;
use crate::errors::AppError;
use crate::image_ops::{crop_image as do_crop_image, CropImageRequest, CropImageResult};
use crate::markdown::{load_markdown as do_load_markdown, MarkdownLoadResult};
use crate::watcher::FileWatcher;
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_initial_file(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let initial = state.initial_file.lock().unwrap();
    Ok(initial.clone())
}

#[tauri::command]
pub fn load_markdown(path: String) -> Result<MarkdownLoadResult, String> {
    do_load_markdown(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_watch(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let res = do_load_markdown(&path).map_err(|e| e.to_string())?;

    let mut watcher_guard = state.watcher.lock().unwrap();
    if watcher_guard.is_none() {
        let watcher = FileWatcher::new(app_handle).map_err(|e| e.to_string())?;
        *watcher_guard = Some(watcher);
    }

    if let Some(watcher) = watcher_guard.as_mut() {
        watcher
            .set_watch_targets(&res.path, &res.image_paths)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn stop_watch(state: State<'_, AppState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().unwrap();
    if let Some(watcher) = watcher_guard.as_mut() {
        watcher.stop();
    }
    Ok(())
}

#[tauri::command]
pub fn crop_image(
    state: State<'_, AppState>,
    request: CropImageRequest,
) -> Result<CropImageResult, String> {
    do_crop_image(request, &state.backup_mgr).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_image(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    state.backup_mgr.restore(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external_editor(app_handle: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::FileNotFound(path).to_string());
    }

    // デフォルトのOS関連付けエディタで開く (tauri-plugin-opener)
    app_handle
        .opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}
