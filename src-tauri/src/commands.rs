use crate::app_state::AppState;
use crate::errors::AppError;
use crate::image_ops::{crop_image as do_crop_image, CropImageRequest, CropImageResult};
use crate::markdown::{load_markdown as do_load_markdown, MarkdownLoadResult};
use crate::watcher::FileWatcher;
use crate::settings::{load_settings as read_settings, merge_settings};
use serde_json::{Map, Value};
use std::path::Path;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn settings_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle.path().app_data_dir().map(|path| path.join("settings.json")).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_settings(app_handle: AppHandle) -> Result<Value, String> {
    read_settings(&settings_path(&app_handle)?).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_settings(app_handle: AppHandle, updates: Value) -> Result<Value, String> {
    let updates: Map<String, Value> = updates.as_object().cloned().ok_or_else(|| "Settings update must be an object.".to_string())?;
    merge_settings(&settings_path(&app_handle)?, updates).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_initial_files(window: WebviewWindow, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.initial_files.lock().unwrap().remove(window.label()).unwrap_or_default())
}

#[tauri::command]
pub fn open_in_new_window(app_handle: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() { return Err(AppError::FileNotFound(path).to_string()); }
    let label = format!("viewer-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis());
    state.initial_files.lock().unwrap().insert(label.clone(), vec![path]);
    WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App("index.html".into()))
        .title("MarkdownViewer").inner_size(1000.0, 750.0).build().map_err(|e| e.to_string())?;
    Ok(())
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
pub fn sync_watch_targets(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    window_label: String,
    targets: Vec<String>,
) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().unwrap();
    if watcher_guard.is_none() {
        *watcher_guard = Some(FileWatcher::new(app_handle).map_err(|e| e.to_string())?);
    }
    watcher_guard
        .as_mut()
        .expect("watcher was initialized")
        .sync_window_targets(&window_label, &targets)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_window_watch_targets(
    state: State<'_, AppState>,
    window_label: String,
) -> Result<(), String> {
    if let Some(watcher) = state.watcher.lock().unwrap().as_mut() {
        watcher
            .remove_window_targets(&window_label)
            .map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn open_containing_folder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() { return Err(AppError::FileNotFound(path).to_string()); }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(format!("/select,{}", path)).spawn().map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "windows"))]
    return Err("Opening a containing folder is only implemented for Windows.".into());
    Ok(())
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    if !Path::new(&path).exists() { return Err(AppError::FileNotFound(path).to_string()); }
    let program = match editor.as_str() { "vscode" => "code", "notepad" => "notepad", _ => return Err("Unsupported editor.".into()) };
    std::process::Command::new(program).arg(path).spawn().map_err(|error| format!("Could not start {program}: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_external_url(app_handle: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("Only HTTP(S) URLs may be opened externally.".into()); }
    app_handle.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
}
