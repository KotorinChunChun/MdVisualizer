use crate::app_state::{AppState, DebugWindowState};
use crate::asset_staging::{
    read_document_asset as do_read_document_asset, DocumentAssetData, StagedAssetResult,
};
use crate::document_edit::{save_markdown_with_assets as do_save_markdown, SaveMarkdownRequest};
use crate::errors::AppError;
use crate::image_ops::{
    crop_image as do_crop_image, save_rendered_image as do_save_rendered_image, CropImageRequest,
    CropImageResult, SaveRenderedImageRequest,
};
use crate::image_references::{
    rename_image_and_references as do_rename_image_and_references,
    update_image_caption as do_update_image_caption, RenameImageResult,
};
use crate::markdown::{
    load_markdown as do_load_markdown, DocumentKind, MarkdownLoadResult,
};
use crate::sharepoint::{
    is_spmd_uri, parse_spmd_uri, SharePointAssetSaveRequest, SharePointAssetSaveResult,
    SharePointAuthConfig, SharePointError,
};
use crate::watcher::FileWatcher;
use serde::Deserialize;
use serde::Serialize;
use std::io::Write;
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
    get_initial_files, load_settings, load_settings_status, open_in_new_window,
    restore_saved_window_geometry, save_fold_state, save_settings, save_window_geometry,
    update_external_app_settings, window_geometry,
};

#[cfg(test)]
use external::{
    expand_external_app_value, is_allowed_external_url, run_powershell_process,
    validate_powershell_request, ValidatedPowerShellRequest,
};
#[cfg(test)]
use std::time::Duration;
#[cfg(test)]
use window_settings::{
    adjacent_geometry, clamp_geometry_to_area, logical_geometry, WorkArea,
};
#[cfg(test)]
use crate::app_state::WindowGeometry;

static CLIPBOARD_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
    pub source: String,
    pub svg: String,
    pub png_bytes: Vec<u8>,
}

fn mermaid_clipboard_file(request: MermaidFileCopyRequest) -> Result<(String, Vec<u8>), String> {
    match request.kind.as_str() {
        "code" => Ok(("mmd".into(), request.source.into_bytes())),
        "svg" => Ok(("svg".into(), request.svg.into_bytes())),
        "png" if !request.png_bytes.is_empty() => Ok(("png".into(), request.png_bytes)),
        "png" => Err("PNGデータが空です。".into()),
        _ => Err("未対応のMermaidコピー形式です。".into()),
    }
}

fn write_mermaid_clipboard_file(extension: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir()
        .join("markdown-viewer")
        .join("clipboard");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("一時フォルダを作成できません: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    for _ in 0..16 {
        let sequence = CLIPBOARD_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!("mermaid-{timestamp}-{sequence}.{extension}"));
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

#[cfg(not(target_os = "windows"))]
fn copy_file_to_clipboard(_path: &Path) -> Result<(), String> {
    Err("ファイルとしてコピーはWindowsでのみ利用できます。".into())
}

#[tauri::command]
pub fn copy_mermaid_file(request: MermaidFileCopyRequest) -> Result<String, String> {
    let (extension, bytes) = mermaid_clipboard_file(request)?;
    let path = write_mermaid_clipboard_file(&extension, &bytes)?;
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
) -> Result<MarkdownLoadResult, String> {
    if !is_spmd_uri(&request.path) {
        return do_save_markdown(request, &state.asset_staging)
            .map_err(|error| error.to_string());
    }
    let config = SharePointAuthConfig::embedded();
    state
        .sharepoint
        .save_markdown(request, &config, |prompt| {
            window
                .emit("sharepoint-authentication-required", prompt)
                .map_err(|error| SharePointError::Authentication(error.to_string()))
        })
        .await
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDocumentAssetRequest {
    document_path: String,
    preferred_filename: String,
    base64: Option<String>,
    text: Option<String>,
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
    state
        .asset_staging
        .stage(
            &request.document_path,
            &request.preferred_filename,
            &bytes,
        )
        .map_err(|error| error.to_string())
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
        return do_read_document_asset(&document_path, &source)
            .map_err(|error| error.to_string());
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

fn heading_id(value: &str, counts: &mut std::collections::HashMap<String, usize>) -> String {
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
    let base = if slug.is_empty() {
        "section".to_string()
    } else {
        slug
    };
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

#[tauri::command]
pub fn diagnose_document(path: String) -> Result<Vec<DiagnosticItem>, String> {
    let loaded = do_load_markdown(&path).map_err(|error| error.to_string())?;
    if loaded.kind != DocumentKind::Markdown {
        return Ok(Vec::new());
    }
    let source = loaded.content.replace("\r\n", "\n");
    let base = PathBuf::from(&loaded.base_dir);
    let mut diagnostics = Vec::new();
    let mut ids = std::collections::HashMap::new();
    let mut heading_ids = std::collections::HashSet::new();
    for (index, line) in source.lines().enumerate() {
        if let Some(captures) = regex::Regex::new(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
            .unwrap()
            .captures(line)
        {
            let id = heading_id(
                captures
                    .get(2)
                    .map(|value| value.as_str())
                    .unwrap_or_default(),
                &mut ids,
            );
            if !heading_ids.insert(id.clone()) {
                diagnostics.push(DiagnosticItem {
                    severity: "warning".into(),
                    kind: "見出しID".into(),
                    line: index + 1,
                    reference: id,
                    message: "見出しIDが重複しています。".into(),
                });
            }
        }
    }
    let link = regex::Regex::new(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)").unwrap();
    for (index, line) in source.lines().enumerate() {
        for captures in link.captures_iter(line) {
            let reference = captures
                .get(1)
                .map(|value| value.as_str())
                .unwrap_or_default();
            if reference.starts_with("http://")
                || reference.starts_with("https://")
                || reference.starts_with("mailto:")
            {
                continue;
            }
            let (file_part, anchor) = reference
                .split_once('#')
                .map_or((reference, None), |(file, anchor)| (file, Some(anchor)));
            let target = if file_part.is_empty() {
                PathBuf::from(&loaded.path)
            } else {
                let candidate = PathBuf::from(file_part);
                if candidate.is_absolute() {
                    candidate
                } else {
                    base.join(candidate)
                }
            };
            if !target.exists() {
                diagnostics.push(DiagnosticItem {
                    severity: "error".into(),
                    kind: if line.trim_start().starts_with("!") {
                        "画像".into()
                    } else {
                        "Markdownリンク".into()
                    },
                    line: index + 1,
                    reference: reference.into(),
                    message: "参照先ファイルが存在しません。".into(),
                });
            } else if let Some(anchor) = anchor {
                if target == PathBuf::from(&loaded.path) && !heading_ids.contains(anchor) {
                    diagnostics.push(DiagnosticItem {
                        severity: "error".into(),
                        kind: "見出しアンカー".into(),
                        line: index + 1,
                        reference: reference.into(),
                        message: "参照先見出しが存在しません。".into(),
                    });
                }
            }
        }
        if let Some(captures) = regex::Regex::new(r"!\[([^\]]*)\]\(")
            .unwrap()
            .captures(line)
        {
            if captures
                .get(1)
                .map(|value| value.as_str().trim().is_empty())
                .unwrap_or(false)
            {
                diagnostics.push(DiagnosticItem {
                    severity: "warning".into(),
                    kind: "画像alt".into(),
                    line: index + 1,
                    reference: line.trim().into(),
                    message: "画像のaltテキストが空です。".into(),
                });
            }
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
}

#[tauri::command]
pub fn rename_image_and_references(
    request: RenameImageReferencesRequest,
) -> Result<RenameImageResult, String> {
    do_rename_image_and_references(
        Path::new(&request.markdown_path),
        Path::new(&request.image_path),
        &request.new_filename,
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
            working_directory: None,
        })
        .unwrap();
        assert_eq!(
            validated.working_directory,
            std::fs::canonicalize(directory.path()).unwrap()
        );
        assert!(validate_powershell_request(RunPowerShellRequest {
            document_path: document.to_string_lossy().into_owned(),
            language: "bash".into(),
            source: "echo unsafe".into(),
            working_directory: None,
        })
        .is_err());
        let text_file = directory.path().join("sample.txt");
        std::fs::write(&text_file, "not markdown").unwrap();
        assert!(validate_powershell_request(RunPowerShellRequest {
            document_path: text_file.to_string_lossy().into_owned(),
            language: "pwsh".into(),
            source: "Get-Location".into(),
            working_directory: None,
        })
        .is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn powershell_process_captures_output_and_enforces_timeout() {
        let directory = tempfile::tempdir().unwrap();
        let output = run_powershell_process(
            ValidatedPowerShellRequest {
                working_directory: directory.path().to_path_buf(),
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
            source: "flowchart LR".into(),
            svg: "<svg/>".into(),
            png_bytes: vec![137, 80, 78, 71],
        };
        assert_eq!(
            mermaid_clipboard_file(request()).unwrap(),
            ("mmd".into(), b"flowchart LR".to_vec())
        );
        let mut svg = request();
        svg.kind = "svg".into();
        assert_eq!(
            mermaid_clipboard_file(svg).unwrap(),
            ("svg".into(), b"<svg/>".to_vec())
        );
        let mut png = request();
        png.kind = "png".into();
        assert_eq!(
            mermaid_clipboard_file(png).unwrap(),
            ("png".into(), vec![137, 80, 78, 71])
        );
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
}
