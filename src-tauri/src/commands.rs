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
use crate::markdown::{load_markdown as do_load_markdown, DocumentKind, MarkdownLoadResult};
use crate::sharepoint::{
    is_spmd_uri, parse_spmd_uri, SharePointAssetSaveRequest, SharePointAssetSaveResult,
    SharePointAuthConfig, SharePointError,
};
use crate::watcher::FileWatcher;
use serde::Deserialize;
use serde::Serialize;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

mod external;
mod window_settings;

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

#[cfg(test)]
use crate::app_state::WindowGeometry;
#[cfg(test)]
use external::{
    expand_external_app_value, is_allowed_external_url, normalize_powershell_path,
    run_powershell_process, validate_powershell_request, ValidatedPowerShellRequest,
};
#[cfg(test)]
use std::time::Duration;
#[cfg(test)]
use window_settings::{adjacent_geometry, clamp_geometry_to_area, logical_geometry, WorkArea};

static CLIPBOARD_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MermaidFileCopyRequest {
    pub kind: String,
    pub diagram_kind: String,
    pub source: String,
    pub svg: String,
    pub png_bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileCopyRequest {
    pub filename: String,
    pub content: String,
    #[serde(default)]
    pub utf8_bom: bool,
}

fn text_clipboard_file(request: TextFileCopyRequest) -> Result<(String, String, Vec<u8>), String> {
    let filename = request.filename.trim();
    if filename.is_empty()
        || filename.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || filename == "."
        || filename == ".."
    {
        return Err("ファイル名に使用できない文字が含まれています。".into());
    }
    let path = Path::new(filename);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 16
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        .ok_or_else(|| "コピーするファイルの拡張子が不正です。".to_string())?
        .to_ascii_lowercase();
    let prefix = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
        .take(48)
        .collect::<String>();
    let prefix = if prefix.is_empty() {
        "file".to_string()
    } else {
        prefix
    };
    let mut bytes =
        Vec::with_capacity(request.content.len() + if request.utf8_bom { 3 } else { 0 });
    if request.utf8_bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(request.content.as_bytes());
    Ok((prefix, extension, bytes))
}

fn mermaid_clipboard_file(
    request: MermaidFileCopyRequest,
) -> Result<(String, String, Vec<u8>), String> {
    let (prefix, code_extension) = match request.diagram_kind.as_str() {
        "mermaid" => ("mermaid", "mmd"),
        "drawio" => ("drawio", "drawio"),
        _ => return Err("未対応の図表ファイル種別です。".into()),
    };
    match request.kind.as_str() {
        "code" => Ok((
            prefix.into(),
            code_extension.into(),
            request.source.into_bytes(),
        )),
        "svg" => Ok((prefix.into(), "svg".into(), request.svg.into_bytes())),
        "png" if !request.png_bytes.is_empty() => {
            Ok((prefix.into(), "png".into(), request.png_bytes))
        }
        "png" => Err("PNGデータが空です。".into()),
        "bmp" if !request.png_bytes.is_empty() => {
            Ok((prefix.into(), "bmp".into(), request.png_bytes))
        }
        "bmp" => Err("BMPデータが空です。".into()),
        _ => Err("未対応のMermaidコピー形式です。".into()),
    }
}

fn write_mermaid_clipboard_file(
    prefix: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("mdvisualizer").join("clipboard");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("一時フォルダを作成できません: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    for _ in 0..16 {
        let sequence = CLIPBOARD_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!("{prefix}-{timestamp}-{sequence}.{extension}"));
        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|error| format!("一時ファイルを書き込めません: {error}"))?;
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("一時ファイルを作成できません: {error}")),
        }
    }
    Err("一時ファイル名を確保できません。".into())
}

#[cfg(target_os = "windows")]
fn copy_file_to_clipboard(path: &Path) -> Result<(), String> {
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::Foundation::{GlobalFree, BOOL, POINT};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::DROPFILES;

    let mut wide = path.as_os_str().encode_wide().collect::<Vec<u16>>();
    wide.extend([0, 0]);
    let byte_len = size_of::<DROPFILES>() + std::mem::size_of_val(wide.as_slice());
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, byte_len);
        if memory.is_null() {
            return Err("クリップボード用メモリを確保できません。".into());
        }
        let data = GlobalLock(memory);
        if data.is_null() {
            GlobalFree(memory);
            return Err("クリップボード用メモリをロックできません。".into());
        }
        ptr::write(
            data.cast::<DROPFILES>(),
            DROPFILES {
                pFiles: size_of::<DROPFILES>() as u32,
                pt: POINT { x: 0, y: 0 },
                fNC: 0 as BOOL,
                fWide: 1 as BOOL,
            },
        );
        ptr::copy_nonoverlapping(
            wide.as_ptr().cast::<u8>(),
            data.cast::<u8>().add(size_of::<DROPFILES>()),
            std::mem::size_of_val(wide.as_slice()),
        );
        GlobalUnlock(memory);
        if OpenClipboard(ptr::null_mut()) == 0 {
            GlobalFree(memory);
            return Err("クリップボードを開けません。".into());
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            GlobalFree(memory);
            return Err("クリップボードを空にできません。".into());
        }
        if SetClipboardData(CF_HDROP as u32, memory).is_null() {
            CloseClipboard();
            GlobalFree(memory);
            return Err("ファイルをクリップボードへ設定できません。".into());
        }
        CloseClipboard();
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn copy_bmp_bytes_to_clipboard(bytes: &[u8]) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_DIB;

    // CF_DIB expects the BMP payload without BITMAPFILEHEADER (14 bytes).
    if bytes.len() < 54 || &bytes[..2] != b"BM" {
        return Err("BMPデータが不正です。".into());
    }
    let dib = &bytes[14..];
    let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, dib.len()) };
    if memory.is_null() {
        return Err("クリップボード用メモリを確保できません。".into());
    }
    let data = unsafe { GlobalLock(memory) };
    if data.is_null() {
        unsafe { GlobalFree(memory) };
        return Err("クリップボード用メモリをロックできません。".into());
    }
    unsafe {
        ptr::copy_nonoverlapping(dib.as_ptr(), data.cast::<u8>(), dib.len());
        GlobalUnlock(memory);
        if OpenClipboard(ptr::null_mut()) == 0 {
            GlobalFree(memory);
            return Err("クリップボードを開けません。".into());
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            GlobalFree(memory);
            return Err("クリップボードを空にできません。".into());
        }
        if SetClipboardData(CF_DIB as u32, memory).is_null() {
            CloseClipboard();
            GlobalFree(memory);
            return Err("BMPをクリップボードへ設定できません。".into());
        }
        CloseClipboard();
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn copy_bmp_bytes_to_clipboard(_bytes: &[u8]) -> Result<(), String> {
    Err("BMP画像のコピーはWindowsでのみ利用できます。".into())
}

#[tauri::command]
pub fn copy_bmp_to_clipboard(bytes: Vec<u8>) -> Result<(), String> {
    copy_bmp_bytes_to_clipboard(&bytes)
}

#[cfg(not(target_os = "windows"))]
fn copy_file_to_clipboard(_path: &Path) -> Result<(), String> {
    Err("ファイルとしてコピーはWindowsでのみ利用できます。".into())
}

#[tauri::command]
pub fn copy_mermaid_file(request: MermaidFileCopyRequest) -> Result<String, String> {
    let (prefix, extension, bytes) = mermaid_clipboard_file(request)?;
    let path = write_mermaid_clipboard_file(&prefix, &extension, &bytes)?;
    if let Err(error) = copy_file_to_clipboard(&path) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn copy_text_file(request: TextFileCopyRequest) -> Result<String, String> {
    let (prefix, extension, bytes) = text_clipboard_file(request)?;
    let path = write_mermaid_clipboard_file(&prefix, &extension, &bytes)?;
    if let Err(error) = copy_file_to_clipboard(&path) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    Ok(path.to_string_lossy().into_owned())
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

#[derive(Serialize)]
pub struct DiagnosticItem {
    severity: String,
    kind: String,
    line: usize,
    reference: String,
    message: String,
}

fn heading_base_id(value: &str) -> String {
    let normalized = value.trim().to_lowercase();
    let mut slug = String::new();
    let mut separator = false;
    for character in normalized.chars() {
        if character.is_alphanumeric() {
            slug.push(character);
            separator = false;
        } else if !slug.is_empty() && !separator {
            slug.push('-');
            separator = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "section".to_string()
    } else {
        slug
    }
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

fn heading_id(value: &str, counts: &mut std::collections::HashMap<String, usize>) -> String {
    let base = heading_base_id(value);
    let count = counts
        .entry(base.clone())
        .and_modify(|value| *value += 1)
        .or_insert(1);
    if *count == 1 {
        base
    } else {
        format!("{}-{}", base, count)
    }
}

fn decode_reference(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

fn fence_marker(line: &str) -> Option<(char, usize, &str)> {
    let indentation = line.len() - line.trim_start_matches(' ').len();
    if indentation > 3 {
        return None;
    }
    let marker = line[indentation..].chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let count = line[indentation..]
        .chars()
        .take_while(|character| *character == marker)
        .count();
    (count >= 3).then(|| (marker, count, &line[indentation + count..]))
}

fn update_fence(fence: &mut Option<(char, usize)>, line: &str) {
    let Some((marker, count, remainder)) = fence_marker(line) else {
        return;
    };
    match *fence {
        None => *fence = Some((marker, count)),
        Some((open_marker, open_count))
            if marker == open_marker && count >= open_count && remainder.trim().is_empty() =>
        {
            *fence = None;
        }
        _ => {}
    }
}

fn atx_heading_title(line: &str) -> Option<&str> {
    let indentation = line.len() - line.trim_start_matches(' ').len();
    if indentation > 3 {
        return None;
    }
    let content = &line[indentation..];
    let hash_count = content
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&hash_count) {
        return None;
    }
    let rest = &content[hash_count..];
    if !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }
    let mut title = rest.trim();
    while title.ends_with('#') {
        let without_hash = title[..title.len() - 1].trim_end();
        if without_hash.len() == title.len() {
            break;
        }
        title = without_hash;
    }
    Some(title)
}

fn markdown_heading_ids(
    source: &str,
) -> (
    std::collections::HashSet<String>,
    std::collections::HashMap<String, usize>,
) {
    let mut counts = std::collections::HashMap::new();
    let mut ids = std::collections::HashSet::new();
    let mut bases = std::collections::HashMap::new();
    let mut fence = None;
    for line in source.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if fence.is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if let Some(title) = atx_heading_title(line) {
            let id = heading_id(title, &mut counts);
            let base = heading_base_id(title);
            *bases.entry(base).or_insert(0) += 1;
            ids.insert(id);
        }
    }
    (ids, bases)
}

fn diagnostic_reference_target(
    reference: &str,
    base: &Path,
    document_path: &Path,
) -> (PathBuf, Option<String>) {
    // Split before percent-decoding so an encoded '#' remains part of a file name.
    let (without_fragment, anchor) = reference
        .split_once('#')
        .map_or((reference, None), |(file, anchor)| {
            (file, Some(decode_reference(anchor)))
        });
    let path_part = without_fragment
        .split_once('?')
        .map_or(without_fragment, |(path, _)| path);
    let path_part = decode_reference(path_part).trim().to_string();
    let target = if path_part.is_empty() {
        document_path.to_path_buf()
    } else {
        let candidate = PathBuf::from(path_part);
        if candidate.is_absolute() {
            candidate
        } else {
            base.join(candidate)
        }
    };
    (target, anchor)
}

fn is_external_reference(reference: &str) -> bool {
    let value = decode_reference(reference).trim().to_ascii_lowercase();
    if value.starts_with("//") {
        return true;
    }
    let is_windows_path = value.as_bytes().get(1) == Some(&b':')
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic);
    !is_windows_path
        && value.find(':').is_some_and(|colon| {
            colon > 0
                && value[..colon].chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
                })
        })
}

fn markdown_references(line: &str) -> Vec<(String, bool)> {
    let pattern = regex::Regex::new(
        r#"(?x)(?P<image>!)?\[[^\]]*\]\(\s*(?:<(?P<bracket>[^>\r\n]*)>|(?P<plain>[^\s)\r\n]+))"#,
    )
    .unwrap();
    pattern
        .captures_iter(line)
        .filter_map(|capture| {
            let reference = capture
                .name("bracket")
                .or_else(|| capture.name("plain"))?
                .as_str()
                .trim()
                .to_string();
            Some((reference, capture.name("image").is_some()))
        })
        .collect()
}

fn html_image_references(line: &str) -> Vec<(String, bool)> {
    let image_tag = regex::Regex::new(r"(?is)<img\b[^>]*>").unwrap();
    let attribute = regex::Regex::new(
        r#"(?i)(?:^|\s)([a-z_:][a-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#,
    )
    .unwrap();
    image_tag
        .find_iter(line)
        .filter_map(|tag| {
            let mut source = None;
            let mut alt = None;
            for capture in attribute.captures_iter(tag.as_str()) {
                let name = capture.get(1)?.as_str();
                let value = capture
                    .get(2)
                    .or_else(|| capture.get(3))
                    .or_else(|| capture.get(4))
                    .map(|value| value.as_str().to_string())
                    .unwrap_or_default();
                if name.eq_ignore_ascii_case("src") {
                    source = Some(value);
                } else if name.eq_ignore_ascii_case("alt") {
                    alt = Some(value);
                }
            }
            source.map(|source| (source, alt.map_or(true, |value| value.trim().is_empty())))
        })
        .collect()
}

fn reference_target_path(reference: &str, base: &Path, document_path: &Path) -> PathBuf {
    let (target, _) = diagnostic_reference_target(reference, base, document_path);
    target.canonicalize().unwrap_or(target)
}

fn collect_document_watch_targets(loaded: &MarkdownLoadResult) -> Vec<String> {
    if loaded.kind != DocumentKind::Markdown {
        return vec![loaded.path.clone()];
    }
    let source = loaded.content.replace("\r\n", "\n");
    let base = PathBuf::from(&loaded.base_dir);
    let obsidian = regex::Regex::new(r#"!?\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]"#).unwrap();
    let mut result = vec![PathBuf::from(&loaded.path)];
    let mut fence = None;
    for line in source.lines() {
        if fence.is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        let mut refs: Vec<String> = markdown_references(line)
            .into_iter()
            .map(|(reference, _)| reference)
            .collect();
        refs.extend(
            html_image_references(line)
                .into_iter()
                .map(|(reference, _)| reference),
        );
        refs.extend(
            obsidian
                .captures_iter(line)
                .filter_map(|capture| capture.get(1).map(|value| value.as_str().trim().to_owned())),
        );
        for reference in refs {
            if is_external_reference(&reference) {
                continue;
            }
            let target = reference_target_path(&reference, &base, Path::new(&loaded.path));
            if target != Path::new(&loaded.path) {
                result.push(target);
            }
        }
    }
    result.sort();
    result.dedup();
    result
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn document_watch_targets(path: String) -> Result<Vec<String>, String> {
    let loaded = do_load_markdown(&path).map_err(|error| error.to_string())?;
    Ok(collect_document_watch_targets(&loaded))
}

#[tauri::command]
pub fn diagnose_document(path: String) -> Result<Vec<DiagnosticItem>, String> {
    let loaded = do_load_markdown(&path).map_err(|error| error.to_string())?;
    if loaded.kind != DocumentKind::Markdown {
        return Ok(Vec::new());
    }
    let source = loaded.content.replace("\r\n", "\n");
    let base = PathBuf::from(&loaded.base_dir);
    let mut diagnostics = Vec::new();
    let (heading_ids, heading_bases) = markdown_heading_ids(&source);
    let mut seen_heading_bases = std::collections::HashMap::new();
    let mut heading_fence = None;
    for (index, line) in source.lines().enumerate() {
        if heading_fence.is_some() {
            update_fence(&mut heading_fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut heading_fence, line);
            continue;
        }
        // Heading duplicate checks are based on the renderer's base slug,
        // before its deterministic -2/-3 suffix is applied.
        if let Some(title) = atx_heading_title(line) {
            let base_id = heading_base_id(title);
            let seen = seen_heading_bases.entry(base_id.clone()).or_insert(0);
            *seen += 1;
            if *seen > 1 && heading_bases.get(&base_id).copied().unwrap_or(0) > 1 {
                diagnostics.push(DiagnosticItem {
                    severity: "warning".into(),
                    kind: "見出しID".into(),
                    line: index + 1,
                    reference: base_id,
                    message: "見出しIDの基底値が重複しています。自動採番されたアンカーを使用してください。".into(),
                });
            }
        }
    }
    let mut fence = None;
    for (index, line) in source.lines().enumerate() {
        if fence.is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        let mut references = markdown_references(line);
        references.extend(
            html_image_references(line)
                .into_iter()
                .map(|(reference, _)| (reference, true)),
        );
        for (reference, is_image) in references {
            if is_external_reference(&reference) {
                continue;
            }
            let (target, anchor) =
                diagnostic_reference_target(&reference, &base, Path::new(&loaded.path));
            if !target.exists() {
                diagnostics.push(DiagnosticItem {
                    severity: "error".into(),
                    kind: if is_image {
                        "画像".into()
                    } else {
                        "Markdownリンク".into()
                    },
                    line: index + 1,
                    reference: reference.clone(),
                    message: "参照先ファイルが存在しません。".into(),
                });
            } else if let Some(anchor) = anchor {
                let target_ids =
                    if target.canonicalize().ok().as_deref() == Some(Path::new(&loaded.path)) {
                        Some(heading_ids.clone())
                    } else if matches!(
                        crate::markdown::document_kind(&target),
                        Some(DocumentKind::Markdown)
                    ) {
                        do_load_markdown(&target.to_string_lossy())
                            .ok()
                            .map(|document| markdown_heading_ids(&document.content).0)
                    } else {
                        None
                    };
                if target_ids.is_some_and(|ids| {
                    !ids.contains(&anchor) && !ids.contains(&heading_base_id(&anchor))
                }) {
                    diagnostics.push(DiagnosticItem {
                        severity: "error".into(),
                        kind: "見出しアンカー".into(),
                        line: index + 1,
                        reference: reference.clone(),
                        message: "参照先見出しが存在しません。".into(),
                    });
                }
            }
        }
        let markdown_alt_empty = regex::Regex::new(r#"!\[([^\]]*)\]\("#)
            .unwrap()
            .captures_iter(line)
            .any(|capture| {
                capture
                    .get(1)
                    .is_some_and(|value| value.as_str().trim().is_empty())
            });
        let html_alt_empty = html_image_references(line)
            .into_iter()
            .any(|(_, alt_empty)| alt_empty);
        if markdown_alt_empty || html_alt_empty {
            diagnostics.push(DiagnosticItem {
                severity: "warning".into(),
                kind: "画像alt".into(),
                line: index + 1,
                reference: line.trim().into(),
                message: "画像のaltテキストが空です。".into(),
            });
        }
    }
    Ok(diagnostics)
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
    let file = Path::new(&path);
    let (vscode_workspace, reuse_vscode_workspace) = if editor == "vscode" {
        match find_running_vscode_workspace(&program, file) {
            Some(workspace) => (Some(workspace), true),
            None => (Some(infer_vscode_workspace(file)?), false),
        }
    } else {
        (None, false)
    };
    let mut command = std::process::Command::new(&program);
    command.args(editor_arguments(
        &editor,
        file,
        vscode_workspace.as_deref(),
        reuse_vscode_workspace,
    )?);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Prevent command shims such as code.cmd from flashing a console
        // window while the GUI editor starts.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", program.display()))?;
    Ok(())
}

fn editor_arguments(
    editor: &str,
    file: &Path,
    vscode_workspace: Option<&Path>,
    reuse_vscode_workspace: bool,
) -> Result<Vec<std::ffi::OsString>, String> {
    match editor {
        "vscode" => {
            let workspace = vscode_workspace
                .ok_or_else(|| "The VS Code workspace could not be determined.".to_string())?;
            let mut arguments = Vec::with_capacity(3);
            if !reuse_vscode_workspace {
                arguments.push(std::ffi::OsString::from("--new-window"));
            }
            arguments.push(workspace.as_os_str().to_owned());
            arguments.push(file.as_os_str().to_owned());
            Ok(arguments)
        }
        "notepad" => Ok(vec![file.as_os_str().to_owned()]),
        _ => Err("Unsupported editor.".into()),
    }
}

#[derive(Debug, Deserialize)]
struct VscodeWorkspaceDescriptor {
    folder: Option<String>,
    workspace: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VscodeCodeWorkspace {
    #[serde(default)]
    folders: Vec<VscodeCodeWorkspaceFolder>,
}

#[derive(Debug, Deserialize)]
struct VscodeCodeWorkspaceFolder {
    path: Option<String>,
    uri: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct VscodeWorkspaceCandidate {
    name: String,
    launch_target: PathBuf,
    roots: Vec<PathBuf>,
}

fn find_running_vscode_workspace(program: &Path, target_file: &Path) -> Option<PathBuf> {
    let mut status_command = std::process::Command::new(program);
    status_command.arg("--status");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        status_command.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(output) = status_command.output() else {
        return None;
    };
    if !output.status.success() {
        return None;
    }

    let mut status = String::from_utf8_lossy(&output.stdout).into_owned();
    status.push_str(&String::from_utf8_lossy(&output.stderr));
    let active_names = parse_vscode_status_workspace_names(&status);
    if active_names.is_empty() {
        return None;
    }
    let Some(storage_root) = vscode_workspace_storage_root() else {
        return None;
    };
    let candidates = load_vscode_workspace_candidates(&storage_root);
    select_active_vscode_workspace(target_file, &active_names, &candidates)
}

fn parse_vscode_status_workspace_names(status: &str) -> std::collections::HashSet<String> {
    let pattern = regex::Regex::new(r"(?m)^\|\s+(?:Folder|Workspace) \((.+)\):\s*.*$")
        .expect("VS Code status pattern must compile");
    pattern
        .captures_iter(status)
        .filter_map(|capture| capture.get(1))
        .map(|name| name.as_str().trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect()
}

fn vscode_workspace_storage_root() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Code").join("User").join("workspaceStorage"))
        .filter(|path| path.is_dir())
}

fn load_vscode_workspace_candidates(storage_root: &Path) -> Vec<VscodeWorkspaceCandidate> {
    let Ok(entries) = std::fs::read_dir(storage_root) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| std::fs::read(entry.path().join("workspace.json")).ok())
        .filter_map(|contents| serde_json::from_slice::<VscodeWorkspaceDescriptor>(&contents).ok())
        .filter_map(workspace_candidate_from_descriptor)
        .collect()
}

fn workspace_candidate_from_descriptor(
    descriptor: VscodeWorkspaceDescriptor,
) -> Option<VscodeWorkspaceCandidate> {
    if let Some(folder_uri) = descriptor.folder {
        let folder = file_uri_to_path(&folder_uri)?;
        let name = folder.file_name()?.to_string_lossy().trim().to_lowercase();
        if name.is_empty() {
            return None;
        }
        return Some(VscodeWorkspaceCandidate {
            name,
            launch_target: folder.clone(),
            roots: vec![folder],
        });
    }

    let workspace_file = file_uri_to_path(descriptor.workspace.as_deref()?)?;
    let name = workspace_file
        .file_stem()?
        .to_string_lossy()
        .trim()
        .to_lowercase();
    if name.is_empty() {
        return None;
    }
    let roots = load_code_workspace_roots(&workspace_file);
    Some(VscodeWorkspaceCandidate {
        name,
        launch_target: workspace_file,
        roots,
    })
}

fn file_uri_to_path(value: &str) -> Option<PathBuf> {
    url::Url::parse(value).ok()?.to_file_path().ok()
}

fn load_code_workspace_roots(workspace_file: &Path) -> Vec<PathBuf> {
    let Ok(contents) = std::fs::read_to_string(workspace_file) else {
        return Vec::new();
    };
    let Ok(workspace) = serde_json::from_str::<VscodeCodeWorkspace>(&normalize_jsonc(&contents))
    else {
        return Vec::new();
    };
    let base = workspace_file.parent().unwrap_or_else(|| Path::new(""));
    workspace
        .folders
        .into_iter()
        .filter_map(|folder| {
            if let Some(uri) = folder.uri {
                return file_uri_to_path(&uri);
            }
            let path = PathBuf::from(folder.path?);
            Some(if path.is_absolute() {
                path
            } else {
                base.join(path)
            })
        })
        .collect()
}

fn normalize_jsonc(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(character) = characters.next() {
        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            output.push(character);
            continue;
        }
        if character == '/' && characters.peek() == Some(&'/') {
            characters.next();
            for comment_character in characters.by_ref() {
                if comment_character == '\n' {
                    output.push('\n');
                    break;
                }
            }
            continue;
        }
        if character == '/' && characters.peek() == Some(&'*') {
            characters.next();
            let mut previous = '\0';
            for comment_character in characters.by_ref() {
                if previous == '*' && comment_character == '/' {
                    break;
                }
                previous = comment_character;
            }
            continue;
        }
        output.push(character);
    }
    strip_json_trailing_commas(&output)
}

fn strip_json_trailing_commas(value: &str) -> String {
    let characters = value.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(value.len());
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in characters.iter().copied().enumerate() {
        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            output.push(character);
            continue;
        }
        if character == ',' {
            let next = characters[index + 1..]
                .iter()
                .copied()
                .find(|next| !next.is_whitespace());
            if matches!(next, Some(']') | Some('}')) {
                continue;
            }
        }
        output.push(character);
    }
    output
}

fn unambiguous_active_workspaces(
    active_names: &std::collections::HashSet<String>,
    candidates: &[VscodeWorkspaceCandidate],
) -> Vec<VscodeWorkspaceCandidate> {
    let mut grouped = std::collections::HashMap::<
        String,
        std::collections::HashMap<String, VscodeWorkspaceCandidate>,
    >::new();
    for candidate in candidates {
        if active_names.contains(&candidate.name) {
            grouped
                .entry(candidate.name.clone())
                .or_default()
                .entry(path_identity(&candidate.launch_target))
                .or_insert_with(|| candidate.clone());
        }
    }
    grouped
        .into_values()
        .filter(|workspaces| workspaces.len() == 1)
        .filter_map(|workspaces| workspaces.into_values().next())
        .collect()
}

fn select_active_vscode_workspace(
    target_file: &Path,
    active_names: &std::collections::HashSet<String>,
    candidates: &[VscodeWorkspaceCandidate],
) -> Option<PathBuf> {
    unambiguous_active_workspaces(active_names, candidates)
        .into_iter()
        .filter_map(|candidate| {
            let depth = candidate
                .roots
                .iter()
                .filter(|root| path_is_within(target_file, root))
                .map(|root| path_depth(root))
                .max()?;
            Some((depth, candidate.launch_target))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, launch_target)| launch_target)
}

fn infer_vscode_workspace(target_file: &Path) -> Result<PathBuf, String> {
    let directory = target_file
        .parent()
        .ok_or_else(|| "The file has no containing directory.".to_string())?;
    let mut git_root = None;
    let mut vscode_root = None;
    let mut project_root = None;
    let mut weak_root = None;
    for ancestor in directory.ancestors() {
        if is_user_home(ancestor) {
            break;
        }
        if let Some(workspace_file) = code_workspace_containing(ancestor, target_file) {
            return Ok(workspace_file);
        }
        if git_root.is_none() && ancestor.join(".git").exists() {
            git_root = Some(ancestor.to_path_buf());
        }
        if vscode_root.is_none() && ancestor.join(".vscode").is_dir() {
            vscode_root = Some(ancestor.to_path_buf());
        }
        if project_root.is_none() && has_project_marker(ancestor) {
            project_root = Some(ancestor.to_path_buf());
        }
        if weak_root.is_none()
            && (ancestor.join(".claude").is_dir() || ancestor.join("AGENTS.md").is_file())
        {
            weak_root = Some(ancestor.to_path_buf());
        }
    }
    Ok(git_root
        .or(vscode_root)
        .or(project_root)
        .or(weak_root)
        .unwrap_or_else(|| directory.to_path_buf()))
}

fn code_workspace_containing(directory: &Path, target_file: &Path) -> Option<PathBuf> {
    let mut workspace_files = std::fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("code-workspace"))
        .collect::<Vec<_>>();
    workspace_files.sort();
    workspace_files.into_iter().find(|workspace_file| {
        load_code_workspace_roots(workspace_file)
            .iter()
            .any(|root| path_is_within(target_file, root))
    })
}

fn has_project_marker(directory: &Path) -> bool {
    const MARKERS: &[&str] = &[
        "Cargo.toml",
        "package.json",
        "pnpm-workspace.yaml",
        "pyproject.toml",
        "go.mod",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "Gemfile",
        "composer.json",
        "mix.exs",
        "deno.json",
        "deno.jsonc",
    ];
    MARKERS
        .iter()
        .any(|marker| directory.join(marker).is_file())
        || std::fs::read_dir(directory).is_ok_and(|entries| {
            entries.filter_map(Result::ok).any(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("sln")
            })
        })
}

fn is_user_home(path: &Path) -> bool {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .is_some_and(|home| path_identity(&home) == path_identity(path))
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let path = path_identity(path);
    let root = path_identity(root);
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|suffix| suffix.starts_with('\\'))
}

fn path_depth(path: &Path) -> usize {
    path_identity(path)
        .split('\\')
        .filter(|component| !component.is_empty())
        .count()
}

fn path_identity(path: &Path) -> String {
    let normalized = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let value = normalized.to_string_lossy().replace('/', "\\");
    #[cfg(target_os = "windows")]
    let value = value.to_lowercase();
    value.trim_end_matches('\\').to_string()
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
    install_candidates
        .into_iter()
        .chain(path_candidates)
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "VS Code が見つかりません。PATH または標準のインストール先を確認してください。".into()
        })
}

fn vscode_path_candidates(directory: &Path) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            directory.join("Code.exe"),
            directory.join("code.exe"),
            directory.join("code.cmd"),
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

    #[test]
    fn vscode_lookup_checks_path_and_install_layout_executables() {
        let candidates = vscode_path_candidates(Path::new("C:/tools/vscode/bin"));
        #[cfg(target_os = "windows")]
        {
            assert!(candidates.ends_with(&[
                PathBuf::from("C:/tools/vscode/bin/Code.exe"),
                PathBuf::from("C:/tools/vscode/bin/code.exe"),
                PathBuf::from("C:/tools/vscode/bin/code.cmd"),
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

    #[test]
    fn external_app_expands_only_allowed_placeholders_without_shell_parsing() {
        let file = Path::new("C:/日本語 & docs/read me.md");
        assert_eq!(
            expand_external_app_value("--file=${file}", file, 42).unwrap(),
            "--file=C:/日本語 & docs/read me.md"
        );
        assert_eq!(
            expand_external_app_value("${dir}", file, 42).unwrap(),
            "C:/日本語 & docs"
        );
        assert_eq!(
            expand_external_app_value("${line}", file, 42).unwrap(),
            "42"
        );
        assert!(expand_external_app_value("${unknown}", file, 1).is_err());
    }

    #[test]
    fn powershell_request_requires_an_explicit_language_and_document_directory() {
        let directory = tempfile::tempdir().unwrap();
        let document = directory.path().join("sample.md");
        std::fs::write(&document, "# sample").unwrap();
        let validated = validate_powershell_request(RunPowerShellRequest {
            document_path: document.to_string_lossy().into_owned(),
            language: "pwsh".into(),
            source: "Get-Location".into(),
        })
        .unwrap();
        assert_eq!(
            validated.working_directory,
            normalize_powershell_path(&std::fs::canonicalize(directory.path()).unwrap())
        );
        assert!(validate_powershell_request(RunPowerShellRequest {
            document_path: document.to_string_lossy().into_owned(),
            language: "bash".into(),
            source: "echo unsafe".into(),
        })
        .is_err());
        let text_file = directory.path().join("sample.txt");
        std::fs::write(&text_file, "not markdown").unwrap();
        assert!(validate_powershell_request(RunPowerShellRequest {
            document_path: text_file.to_string_lossy().into_owned(),
            language: "pwsh".into(),
            source: "Get-Location".into(),
        })
        .is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn powershell_path_normalization_removes_verbatim_prefixes() {
        assert_eq!(
            normalize_powershell_path(Path::new(r"\\?\C:\docs\sample")),
            PathBuf::from(r"C:\docs\sample")
        );
        assert_eq!(
            normalize_powershell_path(Path::new(r"\\?\UNC\server\share\sample")),
            PathBuf::from(r"\\server\share\sample")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn powershell_process_captures_output_and_enforces_timeout() {
        let directory = tempfile::tempdir().unwrap();
        let special_directory = directory.path().join("日本語 & O'Brien");
        std::fs::create_dir(&special_directory).unwrap();
        let output = run_powershell_process(
            ValidatedPowerShellRequest {
                working_directory: special_directory.clone(),
                source: "Write-Output 'safe-output'".into(),
            },
            Duration::from_secs(30),
        )
        .unwrap();
        assert_eq!(
            output.exit_code,
            Some(0),
            "stderr: {} / stdout: {}",
            output.stderr,
            output.stdout
        );
        assert!(output.stdout.contains("safe-output"));
        assert!(!output.timed_out);

        let location = run_powershell_process(
            ValidatedPowerShellRequest {
                working_directory: special_directory.clone(),
                source: "(Get-Location).Path".into(),
            },
            Duration::from_secs(30),
        )
        .unwrap();
        assert_eq!(
            normalize_powershell_path(Path::new(location.stdout.trim())),
            normalize_powershell_path(&special_directory)
        );

        let timed_out = run_powershell_process(
            ValidatedPowerShellRequest {
                working_directory: directory.path().to_path_buf(),
                source: "Start-Sleep -Seconds 5".into(),
            },
            Duration::from_millis(100),
        )
        .unwrap();
        assert!(timed_out.timed_out);
    }

    #[test]
    fn vscode_reuses_a_confirmed_containing_workspace() {
        let file = Path::new("C:/project/docs/readme.md");
        let workspace = Path::new("C:/project");
        let arguments = editor_arguments("vscode", file, Some(workspace), true).unwrap();

        assert_eq!(
            arguments,
            vec![
                std::ffi::OsString::from("C:/project"),
                std::ffi::OsString::from("C:/project/docs/readme.md")
            ]
        );
    }

    #[test]
    fn vscode_forces_a_new_window_without_a_confirmed_match() {
        let file = Path::new("C:/docs/readme.md");
        let workspace = Path::new("C:/workspace");
        let arguments = editor_arguments("vscode", file, Some(workspace), false).unwrap();

        assert_eq!(
            arguments,
            vec![
                std::ffi::OsString::from("--new-window"),
                std::ffi::OsString::from("C:/workspace"),
                std::ffi::OsString::from("C:/docs/readme.md"),
            ],
        );
    }

    #[test]
    fn parses_every_workspace_name_from_vscode_status() {
        let status = r#"Workspace Stats:
|  Window (readme.md - first - Visual Studio Code)
|    Folder (first): 10 files
|  Window (notes.md - second - Visual Studio Code)
|    Folder (Second): 20 files
"#;

        assert_eq!(
            parse_vscode_status_workspace_names(status),
            std::collections::HashSet::from(["first".into(), "second".into()]),
        );
    }

    #[test]
    fn selects_the_deepest_unambiguous_workspace_containing_the_file() {
        let active =
            std::collections::HashSet::from(["docs".into(), "project".into(), "ambiguous".into()]);
        let candidates = vec![
            VscodeWorkspaceCandidate {
                name: "project".into(),
                launch_target: PathBuf::from("C:/work/project"),
                roots: vec![PathBuf::from("C:/work/project")],
            },
            VscodeWorkspaceCandidate {
                name: "docs".into(),
                launch_target: PathBuf::from("C:/work/project/docs"),
                roots: vec![PathBuf::from("C:/work/project/docs")],
            },
            VscodeWorkspaceCandidate {
                name: "ambiguous".into(),
                launch_target: PathBuf::from("C:/work/project/docs"),
                roots: vec![PathBuf::from("C:/work/project/docs")],
            },
            VscodeWorkspaceCandidate {
                name: "ambiguous".into(),
                launch_target: PathBuf::from("D:/other/ambiguous"),
                roots: vec![PathBuf::from("D:/other/ambiguous")],
            },
        ];

        assert_eq!(
            select_active_vscode_workspace(
                Path::new("C:/work/project/docs/manual/readme.md"),
                &active,
                &candidates,
            ),
            Some(PathBuf::from("C:/work/project/docs")),
        );
    }

    #[test]
    fn loads_folder_paths_from_vscode_workspace_storage() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("ExampleWorkspace");
        let entry = root.path().join("workspace-id");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&entry).unwrap();
        let folder_uri = url::Url::from_directory_path(&folder).unwrap();
        std::fs::write(
            entry.join("workspace.json"),
            serde_json::json!({ "folder": folder_uri.as_str() }).to_string(),
        )
        .unwrap();

        assert_eq!(
            load_vscode_workspace_candidates(root.path()),
            vec![VscodeWorkspaceCandidate {
                name: "exampleworkspace".into(),
                launch_target: folder.clone(),
                roots: vec![folder],
            }],
        );
    }

    #[test]
    fn loads_multi_root_code_workspace_paths_with_json_comments() {
        let root = tempfile::tempdir().unwrap();
        let workspace_file = root.path().join("team.code-workspace");
        let first = root.path().join("first");
        let second = root.path().join("second");
        let storage_entry = root.path().join("workspace-id");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::create_dir_all(&storage_entry).unwrap();
        std::fs::write(
            &workspace_file,
            r#"{
                // VS Code workspace folders
                "folders": [{ "path": "first" }, { "path": "second" }],
            }"#,
        )
        .unwrap();
        let workspace_uri = url::Url::from_file_path(&workspace_file).unwrap();
        std::fs::write(
            storage_entry.join("workspace.json"),
            serde_json::json!({ "workspace": workspace_uri.as_str() }).to_string(),
        )
        .unwrap();

        assert_eq!(
            load_vscode_workspace_candidates(root.path()),
            vec![VscodeWorkspaceCandidate {
                name: "team".into(),
                launch_target: workspace_file,
                roots: vec![first, second],
            }],
        );
    }

    #[test]
    fn infers_the_git_root_above_nearer_fallback_markers() {
        let root = tempfile::tempdir().unwrap();
        let repository = root.path().join("repository");
        let docs = repository.join("docs");
        let file = docs.join("manual").join("readme.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(repository.join(".git"), "gitdir: elsewhere").unwrap();
        std::fs::create_dir_all(docs.join(".vscode")).unwrap();

        assert_eq!(infer_vscode_workspace(&file).unwrap(), repository);
    }

    #[test]
    fn explicit_code_workspace_has_priority_when_it_contains_the_file() {
        let root = tempfile::tempdir().unwrap();
        let repository = root.path().join("repository");
        let file = repository.join("docs").join("readme.md");
        let workspace_file = repository.join("documentation.code-workspace");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "# Documentation").unwrap();
        std::fs::create_dir_all(repository.join(".git")).unwrap();
        std::fs::write(&workspace_file, r#"{ "folders": [{ "path": "docs" }] }"#).unwrap();

        assert_eq!(infer_vscode_workspace(&file).unwrap(), workspace_file);
    }

    #[test]
    fn project_manifest_is_used_when_no_stronger_marker_exists() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        let file = project.join("docs").join("readme.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "# Documentation").unwrap();
        std::fs::write(project.join("package.json"), "{}").unwrap();

        assert_eq!(infer_vscode_workspace(&file).unwrap(), project);
    }

    #[test]
    fn adjacent_window_prefers_the_right_of_its_source() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let source = WindowGeometry {
            x: 100,
            y: 120,
            width: 800,
            height: 600,
        };

        assert_eq!(
            adjacent_geometry(source, 820, area),
            WindowGeometry {
                x: 920,
                y: 120,
                width: 800,
                height: 600
            },
        );
    }

    #[test]
    fn adjacent_window_uses_the_left_when_right_would_overflow() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let source = WindowGeometry {
            x: 1100,
            y: 120,
            width: 800,
            height: 600,
        };

        assert_eq!(
            adjacent_geometry(source, 820, area),
            WindowGeometry {
                x: 280,
                y: 120,
                width: 800,
                height: 600
            },
        );
    }

    #[test]
    fn adjacent_window_shrinks_to_right_space_without_a_gap() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let source = WindowGeometry {
            x: 700,
            y: 120,
            width: 800,
            height: 600,
        };

        assert_eq!(
            adjacent_geometry(source, 820, area),
            WindowGeometry {
                x: 1520,
                y: 120,
                // The 20px non-client frame is preserved inside the 400px
                // physical free space.
                width: 380,
                height: 600,
            },
        );
    }

    #[test]
    fn adjacent_window_uses_exactly_the_200px_minimum_space() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let source = WindowGeometry {
            x: 900,
            y: 120,
            width: 800,
            height: 600,
        };

        assert_eq!(
            adjacent_geometry(source, 820, area),
            WindowGeometry {
                x: 1720,
                y: 120,
                width: 180,
                height: 600,
            },
        );
    }

    #[test]
    fn adjacent_window_shrinks_to_left_space_when_right_is_too_narrow() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1000,
            height: 800,
        };
        let source = WindowGeometry {
            x: 300,
            y: 80,
            width: 580,
            height: 600,
        };

        assert_eq!(
            adjacent_geometry(source, 600, area),
            WindowGeometry {
                x: 0,
                y: 80,
                width: 280,
                height: 600,
            },
        );
    }

    #[test]
    fn adjacent_window_uses_the_existing_cascade_when_both_sides_are_under_minimum() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 400,
            height: 800,
        };
        let source = WindowGeometry {
            x: 180,
            y: 80,
            width: 220,
            height: 600,
        };

        assert_eq!(
            adjacent_geometry(source, 240, area),
            WindowGeometry {
                x: 0,
                y: 80,
                width: 220,
                height: 600,
            },
        );
    }

    #[test]
    fn adjacent_window_supports_negative_coordinate_work_areas_in_physical_pixels() {
        let area = WorkArea {
            x: -1920,
            y: -100,
            width: 1920,
            height: 1080,
        };
        let source = WindowGeometry {
            x: -1500,
            y: 40,
            width: 800,
            height: 600,
        };

        assert_eq!(
            adjacent_geometry(source, 820, area),
            WindowGeometry {
                x: -680,
                y: 40,
                width: 660,
                height: 600,
            },
        );
    }

    #[test]
    fn converts_physical_geometry_to_logical_coordinates_for_high_dpi_displays() {
        assert_eq!(
            logical_geometry(
                WindowGeometry {
                    x: -150,
                    y: 75,
                    width: 1000,
                    height: 750,
                },
                1.25,
            ),
            (800.0, 600.0, -120.0, 60.0),
        );
    }

    #[test]
    fn saved_geometry_outside_all_displays_is_clamped_to_a_work_area() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1200,
            height: 800,
        };
        let restored = clamp_geometry_to_area(
            WindowGeometry {
                x: 5000,
                y: -200,
                width: 1600,
                height: 900,
            },
            area,
        );

        assert_eq!(
            restored,
            WindowGeometry {
                x: 0,
                y: 0,
                width: 1200,
                height: 800
            }
        );
    }

    #[test]
    fn prepares_expected_file_contents_for_each_mermaid_copy_kind() {
        let request = || MermaidFileCopyRequest {
            kind: "code".into(),
            diagram_kind: "mermaid".into(),
            source: "flowchart LR".into(),
            svg: "<svg/>".into(),
            png_bytes: vec![137, 80, 78, 71],
        };
        assert_eq!(
            mermaid_clipboard_file(request()).unwrap(),
            ("mermaid".into(), "mmd".into(), b"flowchart LR".to_vec())
        );
        let mut svg = request();
        svg.kind = "svg".into();
        assert_eq!(
            mermaid_clipboard_file(svg).unwrap(),
            ("mermaid".into(), "svg".into(), b"<svg/>".to_vec())
        );
        let mut png = request();
        png.kind = "png".into();
        assert_eq!(
            mermaid_clipboard_file(png).unwrap(),
            ("mermaid".into(), "png".into(), vec![137, 80, 78, 71])
        );
        let mut bmp = request();
        bmp.kind = "bmp".into();
        bmp.png_bytes = vec![0x42, 0x4d, 0, 0];
        assert_eq!(
            mermaid_clipboard_file(bmp).unwrap(),
            ("mermaid".into(), "bmp".into(), vec![0x42, 0x4d, 0, 0])
        );

        let mut drawio = request();
        drawio.diagram_kind = "drawio".into();
        drawio.source = "<mxfile/>".into();
        assert_eq!(
            mermaid_clipboard_file(drawio).unwrap(),
            ("drawio".into(), "drawio".into(), b"<mxfile/>".to_vec())
        );
    }

    #[test]
    fn rejects_invalid_bmp_before_touching_the_clipboard() {
        assert!(copy_bmp_bytes_to_clipboard(&[]).is_err());
        assert!(copy_bmp_bytes_to_clipboard(b"not-a-bmp").is_err());
    }

    #[test]
    fn prepares_validated_text_clipboard_files_with_optional_utf8_bom() {
        assert_eq!(
            text_clipboard_file(TextFileCopyRequest {
                filename: "table.csv".into(),
                content: "a,b\n1,2".into(),
                utf8_bom: true,
            })
            .unwrap(),
            (
                "table".into(),
                "csv".into(),
                [vec![0xef, 0xbb, 0xbf], b"a,b\n1,2".to_vec()].concat()
            ),
        );
        assert!(text_clipboard_file(TextFileCopyRequest {
            filename: "../escape.txt".into(),
            content: "x".into(),
            utf8_bom: false,
        })
        .is_err());
        assert!(text_clipboard_file(TextFileCopyRequest {
            filename: "no-extension".into(),
            content: "x".into(),
            utf8_bom: false,
        })
        .is_err());
    }

    #[test]
    fn standalone_diagrams_are_not_parsed_as_markdown_diagnostics() {
        let directory = tempfile::tempdir().unwrap();
        let mermaid = directory.path().join("broken-links.mermaid");
        let svg = directory.path().join("broken-links.svg");
        std::fs::write(&mermaid, "A --> B\n[missing](missing.md)").unwrap();
        std::fs::write(&svg, r#"<svg><text>[missing](missing.md)</text></svg>"#).unwrap();

        assert!(diagnose_document(mermaid.to_string_lossy().into_owned())
            .unwrap()
            .is_empty());
        assert!(diagnose_document(svg.to_string_lossy().into_owned())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn diagnostics_decode_references_and_check_external_anchors_and_html_alt() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("参照先.md");
        std::fs::write(&target, "# 見出し\n").unwrap();
        let source = directory.path().join("main.md");
        std::fs::write(&source, "# 重複\n# 重複\n[ok](%E5%8F%82%E7%85%A7%E5%85%88.md#%E8%A6%8B%E5%87%BA%E3%81%97)\n[bad](%E5%8F%82%E7%85%A7%E5%85%88.md#missing)\n<img src=\"missing.png\" alt=\"\">\n```md\n[ignored](missing.md)\n````\n").unwrap();
        let items = diagnose_document(source.to_string_lossy().into_owned()).unwrap();
        assert!(items.iter().any(|item| item.kind == "見出しID"));
        assert!(items
            .iter()
            .any(|item| item.kind == "見出しアンカー" && item.reference.contains("missing")));
        assert!(items
            .iter()
            .any(|item| item.kind == "画像" && item.reference == "missing.png"));
        assert!(items.iter().any(|item| item.kind == "画像alt"));
        assert!(!items.iter().any(|item| item.reference.contains("ignored")));
    }

    #[test]
    fn reference_target_decodes_path_and_fragment_without_decoding_encoded_hashes() {
        let base = Path::new("C:/docs");
        let document = base.join("main.md");
        let (target, anchor) = diagnostic_reference_target(
            "%E5%8F%82%E7%85%A7%232.md#%E8%A6%8B%E5%87%BA%E3%81%97%202",
            base,
            &document,
        );

        assert_eq!(target, base.join("参照#2.md"));
        assert_eq!(anchor.as_deref(), Some("見出し 2"));
    }

    #[test]
    fn diagnostics_handle_indented_headings_and_do_not_parse_fenced_content() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("headings.md");
        std::fs::write(
            &source,
            "  # Same\n# Same\n~~~md\n# Same\n[missing](missing.md)\n~~~\n",
        )
        .unwrap();

        let items = diagnose_document(source.to_string_lossy().into_owned()).unwrap();
        let duplicate_lines: Vec<_> = items
            .iter()
            .filter(|item| item.kind == "見出しID")
            .map(|item| item.line)
            .collect();
        assert_eq!(duplicate_lines, vec![2]);
        assert!(!items.iter().any(|item| item.reference.contains("missing")));
    }

    #[test]
    fn diagnostics_check_each_html_image_and_keep_markdown_link_kind() {
        let directory = tempfile::tempdir().unwrap();
        let image = directory.path().join("present.png");
        std::fs::write(&image, b"image").unwrap();
        let source = directory.path().join("images.md");
        std::fs::write(
            &source,
            "[missing](missing.md) ![missing alt](present.png)\n<img alt=\"ok\" src=\"present.png\"><img src=\"present.png\" alt=\"\"><img src=missing.png>\n",
        )
        .unwrap();

        let items = diagnose_document(source.to_string_lossy().into_owned()).unwrap();
        assert!(items.iter().any(|item| item.kind == "Markdownリンク"));
        assert!(items
            .iter()
            .any(|item| item.kind == "画像" && item.reference == "missing.png"));
        assert!(items
            .iter()
            .any(|item| item.kind == "画像alt" && item.line == 2));
        assert_eq!(
            items.iter().filter(|item| item.kind == "画像alt").count(),
            1
        );
    }

    #[test]
    fn document_watch_targets_return_decoded_local_references_and_skip_external_and_fences() {
        let directory = tempfile::tempdir().unwrap();
        let referenced = directory.path().join("参照先.md");
        std::fs::write(&referenced, "# target").unwrap();
        let image = directory.path().join("image.png");
        std::fs::write(&image, b"image").unwrap();
        let source = directory.path().join("watch.md");
        std::fs::write(
            &source,
            "[doc](%E5%8F%82%E7%85%A7%E5%85%88.md)\n<img src=image.png alt=\"image\">\n[web](https://example.com/ref.md)\n```\n[ignored](ignored.md)\n```\n",
        )
        .unwrap();

        let targets = document_watch_targets(source.to_string_lossy().into_owned()).unwrap();
        let source = std::fs::canonicalize(source)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let referenced = std::fs::canonicalize(referenced)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let image = std::fs::canonicalize(image)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut expected = vec![source, image, referenced];
        expected.sort();
        assert_eq!(targets, expected);
        assert!(!targets.iter().any(|target| target.contains("ignored")));
    }
}
