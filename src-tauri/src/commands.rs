use crate::app_state::{AppState, DebugWindowState};
use crate::asset_staging::{
    delete_document_asset as do_delete_document_asset,
    read_document_asset as do_read_document_asset, DocumentAssetData, StagedAssetResult,
};
use crate::document_edit::{
    create_markdown as do_create_markdown, rename_document as do_rename_document,
    save_markdown_with_assets as do_save_markdown, CreateMarkdownRequest, RenameDocumentRequest,
    SaveMarkdownRequest,
};
use crate::errors::AppError;
use crate::file_lock::{atomic_write, with_lock};
use crate::image_ops::{
    crop_image as do_crop_image, save_rendered_image as do_save_rendered_image, CropImageRequest,
    CropImageResult, SaveRenderedImageRequest,
};
use crate::image_references::{
    rename_image_and_references_with_options as do_rename_image_and_references,
    update_image_caption as do_update_image_caption, RenameImageResult,
};
use crate::markdown::{load_markdown as do_load_markdown, MarkdownLoadResult};
use crate::sharepoint::{
    is_spmd_uri, parse_spmd_uri, SharePointAssetSaveRequest, SharePointAssetSaveResult,
    SharePointAuthConfig, SharePointError,
};
use crate::watcher::FileWatcher;
use serde::Deserialize;
use serde::Serialize;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

mod clipboard;
mod diagnostics;
mod editor_launch;
mod external;
mod sharepoint_settings;
mod window_settings;

pub use clipboard::{copy_bmp_to_clipboard, copy_mermaid_file, copy_text_file};
pub use diagnostics::{diagnose_document, document_watch_targets};
pub use editor_launch::{open_containing_folder, open_external_editor, open_in_editor};
pub use sharepoint_settings::{sharepoint_connection_info, validate_sharepoint_uri};

pub use external::{
    open_external_app, open_external_url, run_powershell, OpenExternalAppRequest,
    PowerShellRunResult, RunPowerShellRequest,
};
pub use window_settings::{
    get_initial_files, load_markdown_style, load_settings, load_settings_status,
    open_in_new_window, open_markdown_style, restore_saved_window_geometry, save_fold_state,
    save_markdown_style, save_settings, save_window_geometry, update_external_app_settings,
    window_geometry,
};

fn save_table_csv_file(path: &Path, content: &str) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("CSVの保存先は絶対パスで指定してください。".to_string());
    }
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"))
    {
        return Err("CSVの保存先には.csvファイルを指定してください。".to_string());
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err("CSVの保存先フォルダーが存在しません。".to_string());
    }
    with_lock(path, || atomic_write(path, content.as_bytes()))
        .map_err(|error| error.to_string())?;
    Ok(path.to_path_buf())
}

#[tauri::command]
pub fn save_table_csv(path: String, content: String) -> Result<String, String> {
    save_table_csv_file(Path::new(&path), &content)
        .map(|saved| saved.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn report_debug_window_state(
    window: WebviewWindow,
    state: State<'_, AppState>,
    mut snapshot: DebugWindowState,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        snapshot.label = window.label().to_string();
        state
            .debug_windows
            .lock()
            .map_err(|_| "Debug window state is unavailable.".to_string())?
            .insert(snapshot.label.clone(), snapshot);
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (window, state, &mut snapshot);
        Err("Debug state API is disabled in release builds.".to_string())
    }
}

#[tauri::command]
pub async fn load_markdown(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<MarkdownLoadResult, String> {
    if !is_spmd_uri(&path) {
        return do_load_markdown(&path).map_err(|error| error.to_string());
    }
    let source = parse_spmd_uri(&path).map_err(|error| error.to_string())?;
    let config = SharePointAuthConfig::embedded();
    state
        .sharepoint
        .load_markdown(&source, &config, |prompt| {
            window
                .emit("sharepoint-authentication-required", prompt)
                .map_err(|error| SharePointError::Authentication(error.to_string()))
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_markdown(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: SaveMarkdownRequest,
) -> Result<MarkdownSaveResult, String> {
    if !is_spmd_uri(&request.path) {
        return match do_save_markdown(request.clone(), &state.asset_staging) {
            Ok(document) => Ok(MarkdownSaveResult::Saved { document }),
            Err(AppError::Conflict(_)) => do_load_markdown(&request.path)
                .map(|latest| MarkdownSaveResult::Conflict { latest })
                .map_err(|error| error.to_string()),
            Err(error) => Err(error.to_string()),
        };
    }
    let config = SharePointAuthConfig::embedded();
    let saved = state
        .sharepoint
        .save_markdown(request.clone(), &config, |prompt| {
            window
                .emit("sharepoint-authentication-required", prompt)
                .map_err(|error| SharePointError::Authentication(error.to_string()))
        })
        .await;
    match saved {
        Ok(document) => Ok(MarkdownSaveResult::Saved { document }),
        Err(SharePointError::MarkdownConflict) => {
            let source = parse_spmd_uri(&request.path).map_err(|error| error.to_string())?;
            state
                .sharepoint
                .load_markdown(&source, &config, |prompt| {
                    window
                        .emit("sharepoint-authentication-required", prompt)
                        .map_err(|error| SharePointError::Authentication(error.to_string()))
                })
                .await
                .map(|latest| MarkdownSaveResult::Conflict { latest })
                .map_err(|error| error.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn rename_document(request: RenameDocumentRequest) -> Result<MarkdownLoadResult, String> {
    do_rename_document(request).map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum MarkdownSaveResult {
    Saved { document: MarkdownLoadResult },
    Conflict { latest: MarkdownLoadResult },
}

#[tauri::command]
pub fn create_markdown(request: CreateMarkdownRequest) -> Result<MarkdownLoadResult, String> {
    do_create_markdown(request).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDocumentAssetRequest {
    document_path: String,
    preferred_filename: String,
    base64: Option<String>,
    text: Option<String>,
    preferred_source: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageClipboardImageRequest {
    document_path: String,
    preferred_filename: String,
    base64: String,
    destination: String,
    absolute_directory: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedClipboardImageResult {
    id: String,
    filename: String,
    media_type: &'static str,
    base64: String,
}

#[tauri::command]
pub fn stage_document_asset(
    state: State<'_, AppState>,
    request: StageDocumentAssetRequest,
) -> Result<StagedAssetResult, String> {
    let bytes = if let Some(text) = request.text {
        text.into_bytes()
    } else {
        base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            request.base64.unwrap_or_default(),
        )
        .map_err(|_| "Base64 asset data is invalid.".to_string())?
    };
    if let Some(source) = request
        .preferred_source
        .filter(|value| !value.trim().is_empty())
    {
        state
            .asset_staging
            .stage_relative(&request.document_path, &source, &bytes)
    } else {
        state
            .asset_staging
            .stage(&request.document_path, &request.preferred_filename, &bytes)
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_staged_text_asset(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<(), String> {
    state
        .asset_staging
        .update_text(&id, &text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn stage_clipboard_image(
    state: State<'_, AppState>,
    request: StageClipboardImageRequest,
) -> Result<StagedClipboardImageResult, String> {
    let source = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, request.base64)
        .map_err(|_| "Base64 clipboard image data is invalid.".to_string())?;
    let image = image::load_from_memory(&source)
        .map_err(|_| "Clipboard image data is not a supported raster image.".to_string())?;
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|error| format!("Convert clipboard image to PNG: {error}"))?;
    let staged = state
        .asset_staging
        .stage_at(
            &request.document_path,
            &request.preferred_filename,
            &request.destination,
            request.absolute_directory.as_deref(),
            png.get_ref(),
        )
        .map_err(|error| error.to_string())?;
    Ok(StagedClipboardImageResult {
        id: staged.id,
        filename: staged.filename,
        media_type: "image/png",
        base64: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, png.get_ref()),
    })
}

#[tauri::command]
pub fn discard_staged_assets(state: State<'_, AppState>, ids: Vec<String>) {
    state.asset_staging.discard(&ids);
}

#[tauri::command]
pub async fn read_document_asset(
    window: WebviewWindow,
    state: State<'_, AppState>,
    document_path: String,
    source: String,
) -> Result<DocumentAssetData, String> {
    if !is_spmd_uri(&document_path) {
        return do_read_document_asset(&document_path, &source).map_err(|error| error.to_string());
    }
    let document = parse_spmd_uri(&document_path).map_err(|error| error.to_string())?;
    let config = SharePointAuthConfig::embedded();
    state
        .sharepoint
        .load_asset(&document, &source, &config, |prompt| {
            window
                .emit("sharepoint-authentication-required", prompt)
                .map_err(|error| SharePointError::Authentication(error.to_string()))
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_sharepoint_asset(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: SharePointAssetSaveRequest,
) -> Result<SharePointAssetSaveResult, String> {
    let config = SharePointAuthConfig::embedded();
    state
        .sharepoint
        .save_asset(request, &config, |prompt| {
            window
                .emit("sharepoint-authentication-required", prompt)
                .map_err(|error| SharePointError::Authentication(error.to_string()))
        })
        .await
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteDocumentAssetRequest {
    pub document_path: String,
    pub source: String,
    pub expected_revision: Option<String>,
}

#[tauri::command]
pub fn delete_document_asset(request: DeleteDocumentAssetRequest) -> Result<(), String> {
    do_delete_document_asset(
        &request.document_path,
        &request.source,
        request.expected_revision.as_deref(),
    )
    .map_err(|error| error.to_string())
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
pub fn save_rendered_image(
    state: State<'_, AppState>,
    request: SaveRenderedImageRequest,
) -> Result<CropImageResult, String> {
    do_save_rendered_image(request, &state.backup_mgr).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_image_for_edit(path: String) -> Result<Option<String>, String> {
    crate::image_ops::read_image_for_edit(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_rendered_image(path: String, png_bytes: Vec<u8>) -> Result<crate::image_ops::CropImageResult, String> {
    crate::image_ops::create_rendered_image(&path, &png_bytes).map_err(|e| e.to_string())
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateImageCaptionRequest {
    markdown_path: String,
    source_offset: usize,
    expected_source: String,
    caption: String,
}

#[tauri::command]
pub fn update_image_caption(request: UpdateImageCaptionRequest) -> Result<(), String> {
    do_update_image_caption(
        Path::new(&request.markdown_path),
        request.source_offset,
        &request.expected_source,
        &request.caption,
    )
    .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameImageReferencesRequest {
    markdown_path: String,
    image_path: String,
    new_filename: String,
    #[serde(default)]
    overwrite: bool,
}

#[tauri::command]
pub fn rename_image_and_references(
    request: RenameImageReferencesRequest,
) -> Result<RenameImageResult, String> {
    do_rename_image_and_references(
        Path::new(&request.markdown_path),
        Path::new(&request.image_path),
        &request.new_filename,
        request.overwrite,
    )
    .map_err(|error| error.to_string())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_save_conflict_serializes_with_the_latest_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("latest.md");
        std::fs::write(&path, "# latest").unwrap();
        let latest = do_load_markdown(&path.to_string_lossy()).unwrap();
        let value = serde_json::to_value(MarkdownSaveResult::Conflict { latest }).unwrap();

        assert_eq!(value["status"], "conflict");
        assert_eq!(value["latest"]["content"], "# latest");
        assert!(!value["latest"]["revision"].as_str().unwrap().is_empty());
    }

    #[test]
    fn table_csv_save_requires_an_absolute_csv_path_and_writes_exact_content() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("table.csv");
        let content = "\u{feff}名前,値\nA,1";

        assert_eq!(save_table_csv_file(&path, content).unwrap(), path);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        assert!(save_table_csv_file(Path::new("relative.csv"), content).is_err());
        assert!(save_table_csv_file(&directory.path().join("table.txt"), content).is_err());
    }

}
