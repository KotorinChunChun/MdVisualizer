use crate::app_state::AppState;
use crate::errors::AppError;
use crate::image_ops::{crop_image as do_crop_image, CropImageRequest, CropImageResult};
use crate::markdown::{load_markdown as do_load_markdown, MarkdownLoadResult};
use crate::settings::{
    load_application_settings, merge_fold_state, merge_settings, SettingsLoadResult,
};
use crate::watcher::FileWatcher;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn settings_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|path| path.join("settings.json"))
        .map_err(|error| error.to_string())
}

fn fold_state_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|path| path.join("fold-state.json"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_settings(app_handle: AppHandle) -> Result<Value, String> {
    Ok(
        load_application_settings(&settings_path(&app_handle)?, &fold_state_path(&app_handle)?)
            .map_err(|error| error.to_string())?
            .settings,
    )
}

/// Structured recovery metadata for callers that want to surface a repair
/// notice after a malformed settings file was quarantined.
#[tauri::command]
pub fn load_settings_status(app_handle: AppHandle) -> Result<SettingsLoadResult, String> {
    load_application_settings(&settings_path(&app_handle)?, &fold_state_path(&app_handle)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_settings(app_handle: AppHandle, updates: Value) -> Result<Value, String> {
    let updates: Map<String, Value> = updates
        .as_object()
        .cloned()
        .ok_or_else(|| "Settings update must be an object.".to_string())?;
    merge_settings(&settings_path(&app_handle)?, updates).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_fold_state(
    app_handle: AppHandle,
    document_path: String,
    state: Value,
) -> Result<Value, String> {
    merge_fold_state(&fold_state_path(&app_handle)?, document_path, state)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_initial_files(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state
        .initial_files
        .lock()
        .map_err(|_| "Initial file state is unavailable.".to_string())?
        .remove(window.label())
        .map_or_else(|| Ok(Vec::new()), Ok)
}

#[tauri::command]
pub async fn open_in_new_window(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(AppError::FileNotFound(path).to_string());
    }
    let sequence = state.window_sequence.fetch_add(1, Ordering::Relaxed);
    let label = format!(
        "viewer-{}-{sequence}",
        chrono::Utc::now().timestamp_millis()
    );
    {
        let mut initial_files = state
            .initial_files
            .lock()
            .map_err(|_| "Initial file state is unavailable.".to_string())?;
        initial_files.insert(label.clone(), vec![path]);
    }
    // On Windows, building a webview window from a synchronous command can
    // deadlock. Async commands run on Tauri's async worker thread.
    if let Err(error) =
        WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App("index.html".into()))
            .title("MarkdownViewer")
            .inner_size(1000.0, 750.0)
            .build()
    {
        if let Ok(mut initial_files) = state.initial_files.lock() {
            initial_files.remove(&label);
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn load_markdown(path: String) -> Result<MarkdownLoadResult, String> {
    do_load_markdown(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_watch(
    app_handle: AppHandle,
    window: WebviewWindow,
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
            .sync_window_targets(
                window.label(),
                &std::iter::once(res.path)
                    .chain(res.image_paths)
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn stop_watch(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().unwrap();
    if let Some(watcher) = watcher_guard.as_mut() {
        watcher
            .remove_window_targets(window.label())
            .map_err(|error| error.to_string())?;
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
pub fn has_image_backup(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    Ok(state.backup_mgr.has_backup(Path::new(&path)))
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
    if !Path::new(&path).exists() {
        return Err(AppError::FileNotFound(path).to_string());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "windows"))]
    return Err("Opening a containing folder is only implemented for Windows.".into());
    Ok(())
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(AppError::FileNotFound(path).to_string());
    }
    let program = match editor.as_str() {
        "vscode" => resolve_vscode_executable()?,
        "notepad" => PathBuf::from("notepad"),
        _ => return Err("Unsupported editor.".into()),
    };
    std::process::Command::new(&program)
        .arg(path)
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", program.display()))?;
    Ok(())
}

fn resolve_vscode_executable() -> Result<PathBuf, String> {
    let path_candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .flat_map(|directory| vscode_path_candidates(&directory))
                .collect()
        })
        .unwrap_or_default();
    let install_candidates: Vec<PathBuf> = vscode_install_directories()
        .into_iter()
        .flat_map(|directory| vscode_path_candidates(&directory))
        .collect();
    path_candidates
        .into_iter()
        .chain(install_candidates)
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "VS Code が見つかりません。PATH または標準のインストール先を確認してください。".into()
        })
}

fn vscode_path_candidates(directory: &Path) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            directory.join("code.cmd"),
            directory.join("code.exe"),
            directory.join("Code.exe"),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![directory.join("code")]
    }
}

fn vscode_install_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        directories.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Microsoft VS Code"),
        );
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(program_files) = std::env::var_os(variable) {
            directories.push(PathBuf::from(program_files).join("Microsoft VS Code"));
        }
    }
    directories
}

#[tauri::command]
pub fn open_external_url(app_handle: AppHandle, url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("Only HTTP(S) and mailto URLs may be opened externally.".into());
    }
    app_handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

fn is_allowed_external_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vscode_lookup_checks_path_and_install_layout_executables() {
        let candidates = vscode_path_candidates(Path::new("C:/tools/vscode/bin"));
        #[cfg(target_os = "windows")]
        {
            assert!(candidates.ends_with(&[
                PathBuf::from("C:/tools/vscode/bin/code.cmd"),
                PathBuf::from("C:/tools/vscode/bin/code.exe"),
                PathBuf::from("C:/tools/vscode/bin/Code.exe"),
            ]));
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(candidates, vec![PathBuf::from("C:/tools/vscode/bin/code")]);
        }
    }

    #[test]
    fn external_url_policy_allows_only_safe_schemes() {
        assert!(is_allowed_external_url("https://example.com"));
        assert!(is_allowed_external_url("http://example.com"));
        assert!(is_allowed_external_url("mailto:test@example.com"));
        assert!(!is_allowed_external_url("file:///C:/secret.txt"));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
    }
}
