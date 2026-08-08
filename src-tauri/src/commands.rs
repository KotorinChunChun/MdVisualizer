use crate::app_state::AppState;
use crate::errors::AppError;
use crate::image_ops::{
    crop_image as do_crop_image, save_rendered_image as do_save_rendered_image, CropImageRequest,
    CropImageResult, SaveRenderedImageRequest,
};
use crate::image_references::{
    rename_image_and_references as do_rename_image_and_references,
    update_image_caption as do_update_image_caption, RenameImageResult,
};
use crate::markdown::{load_markdown as do_load_markdown, MarkdownLoadResult};
use crate::settings::{
    load_application_settings, load_settings as load_settings_file, merge_external_app_settings,
    merge_fold_state, merge_settings, SettingsLoadResult,
};
use crate::watcher::FileWatcher;
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
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

/// The next-start geometry is deliberately shared rather than bound to an
/// ephemeral viewer-* label.  The last window closed therefore becomes the
/// next main window, even after opening documents in separate windows.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn geometry_from_window(window: &WebviewWindow) -> Result<WindowGeometry, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    Ok(WindowGeometry { x: position.x, y: position.y, width: size.width, height: size.height })
}

fn geometry_from_native_window(window: &tauri::Window) -> Result<WindowGeometry, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    Ok(WindowGeometry { x: position.x, y: position.y, width: size.width, height: size.height })
}

fn work_areas(window: &WebviewWindow) -> Result<Vec<WorkArea>, String> {
    let areas = window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|monitor| {
            let area = monitor.work_area();
            WorkArea {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect::<Vec<_>>();
    Ok(areas)
}

fn geometry_is_visible(geometry: WindowGeometry, area: WorkArea) -> bool {
    let right = geometry.x.saturating_add(geometry.width as i32);
    let bottom = geometry.y.saturating_add(geometry.height as i32);
    let area_right = area.x.saturating_add(area.width as i32);
    let area_bottom = area.y.saturating_add(area.height as i32);
    geometry.x < area_right && right > area.x && geometry.y < area_bottom && bottom > area.y
}

fn clamp_geometry_to_area(mut geometry: WindowGeometry, area: WorkArea) -> WindowGeometry {
    geometry.width = geometry.width.min(area.width.max(1));
    geometry.height = geometry.height.min(area.height.max(1));
    let max_x = area.x.saturating_add(area.width.saturating_sub(geometry.width) as i32);
    let max_y = area.y.saturating_add(area.height.saturating_sub(geometry.height) as i32);
    geometry.x = geometry.x.clamp(area.x, max_x);
    geometry.y = geometry.y.clamp(area.y, max_y);
    geometry
}

fn adjacent_geometry(source: WindowGeometry, source_outer_width: u32, area: WorkArea) -> WindowGeometry {
    let right_x = source.x.saturating_add(source_outer_width as i32);
    let area_right = area.x.saturating_add(area.width as i32);
    let x = if right_x.saturating_add(source.width as i32) <= area_right {
        right_x
    } else {
        source.x.saturating_sub(source.width as i32)
    };
    clamp_geometry_to_area(WindowGeometry { x, y: source.y, width: source.width, height: source.height }, area)
}

fn saved_window_geometry(app_handle: &AppHandle) -> Result<Option<WindowGeometry>, String> {
    let settings = load_settings_file(&settings_path(app_handle)?).map_err(|error| error.to_string())?;
    match settings.get("windowGeometry") {
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|error| format!("Saved window geometry is invalid: {error}")),
        None => Ok(None),
    }
}

pub fn restore_saved_window_geometry(app_handle: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let Some(saved) = saved_window_geometry(app_handle)? else { return Ok(()); };
    if saved.width == 0 || saved.height == 0 { return Ok(()); }
    let areas = work_areas(window)?;
    let geometry = if areas.iter().any(|area| geometry_is_visible(saved, *area)) {
        saved
    } else {
        let fallback = areas.first().copied().ok_or_else(|| "No display is available.".to_string())?;
        clamp_geometry_to_area(saved, fallback)
    };
    window
        .set_size(PhysicalSize::new(geometry.width, geometry.height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(geometry.x, geometry.y))
        .map_err(|error| error.to_string())
}

pub fn save_window_geometry(app_handle: &AppHandle, window: &tauri::Window) -> Result<(), String> {
    let geometry = geometry_from_native_window(window)?;
    let mut updates = Map::new();
    updates.insert(
        "windowGeometry".into(),
        serde_json::to_value(geometry).map_err(|error| error.to_string())?,
    );
    merge_settings(&settings_path(app_handle)?, updates).map_err(|error| error.to_string())?;
    Ok(())
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
pub fn update_external_app_settings(
    app_handle: AppHandle,
    upserts: Vec<Value>,
    removed_ids: Vec<String>,
    presentation_line_threshold: u64,
    image_a4_target_width: u64,
    image_equal_padding: u64,
) -> Result<Value, String> {
    merge_external_app_settings(
        &settings_path(&app_handle)?,
        upserts,
        removed_ids,
        presentation_line_threshold,
        image_a4_target_width,
        image_equal_padding,
    )
    .map_err(|error| error.to_string())
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
    window: WebviewWindow,
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
    let source = geometry_from_window(&window)?;
    let source_outer_width = window.outer_size().map_err(|error| error.to_string())?.width;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let area = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|monitor| {
            let area = monitor.work_area();
            WorkArea { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height }
        })
        .ok_or_else(|| "No display is available.".to_string())?;
    let geometry = adjacent_geometry(source, source_outer_width, area);

    // On Windows, building a webview window from a synchronous command can
    // deadlock. Async commands run on Tauri's async worker thread.
    if let Err(error) =
        WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App("index.html".into()))
            .title("MarkdownViewer")
            .inner_size(geometry.width as f64 / scale_factor, geometry.height as f64 / scale_factor)
            .position(geometry.x as f64 / scale_factor, geometry.y as f64 / scale_factor)
            .prevent_overflow()
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
    let base = if slug.is_empty() { "section".to_string() } else { slug };
    let count = counts.entry(base.clone()).and_modify(|value| *value += 1).or_insert(1);
    if *count == 1 { base } else { format!("{}-{}", base, count) }
}

#[tauri::command]
pub fn diagnose_document(path: String) -> Result<Vec<DiagnosticItem>, String> {
    let loaded = do_load_markdown(&path).map_err(|error| error.to_string())?;
    let source = loaded.content.replace("\r\n", "\n");
    let base = PathBuf::from(&loaded.base_dir);
    let mut diagnostics = Vec::new();
    let mut ids = std::collections::HashMap::new();
    let mut heading_ids = std::collections::HashSet::new();
    for (index, line) in source.lines().enumerate() {
        if let Some(captures) = regex::Regex::new(r"^(#{1,6})\s+(.+?)\s*#*\s*$").unwrap().captures(line) {
            let id = heading_id(captures.get(2).map(|value| value.as_str()).unwrap_or_default(), &mut ids);
            if !heading_ids.insert(id.clone()) {
                diagnostics.push(DiagnosticItem { severity: "warning".into(), kind: "見出しID".into(), line: index + 1, reference: id, message: "見出しIDが重複しています。".into() });
            }
        }
    }
    let link = regex::Regex::new(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)").unwrap();
    for (index, line) in source.lines().enumerate() {
        for captures in link.captures_iter(line) {
            let reference = captures.get(1).map(|value| value.as_str()).unwrap_or_default();
            if reference.starts_with("http://") || reference.starts_with("https://") || reference.starts_with("mailto:") { continue; }
            let (file_part, anchor) = reference.split_once('#').map_or((reference, None), |(file, anchor)| (file, Some(anchor)));
            let target = if file_part.is_empty() { PathBuf::from(&loaded.path) } else { let candidate = PathBuf::from(file_part); if candidate.is_absolute() { candidate } else { base.join(candidate) } };
            if !target.exists() {
                diagnostics.push(DiagnosticItem { severity: "error".into(), kind: if line.trim_start().starts_with("!") { "画像".into() } else { "Markdownリンク".into() }, line: index + 1, reference: reference.into(), message: "参照先ファイルが存在しません。".into() });
            } else if let Some(anchor) = anchor {
                if target == PathBuf::from(&loaded.path) && !heading_ids.contains(anchor) {
                    diagnostics.push(DiagnosticItem { severity: "error".into(), kind: "見出しアンカー".into(), line: index + 1, reference: reference.into(), message: "参照先見出しが存在しません。".into() });
                }
            }
        }
        if let Some(captures) = regex::Regex::new(r"!\[([^\]]*)\]\(").unwrap().captures(line) {
            if captures.get(1).map(|value| value.as_str().trim().is_empty()).unwrap_or(false) {
                diagnostics.push(DiagnosticItem { severity: "warning".into(), kind: "画像alt".into(), line: index + 1, reference: line.trim().into(), message: "画像のaltテキストが空です。".into() });
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
    let mut command = std::process::Command::new(&program);
    command.args(editor_arguments(&editor, Path::new(&path))?);
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

fn editor_arguments(editor: &str, file: &Path) -> Result<Vec<std::ffi::OsString>, String> {
    match editor {
        // Passing the folder before the file makes the containing directory a
        // VS Code workspace.  VS Code itself reuses an already-open matching
        // workspace; no unstable process/window introspection is required.
        "vscode" => {
            let directory = file.parent().ok_or_else(|| "The file has no containing directory.".to_string())?;
            Ok(vec![directory.as_os_str().to_owned(), file.as_os_str().to_owned()])
        }
        "notepad" => Ok(vec![file.as_os_str().to_owned()]),
        _ => Err("Unsupported editor.".into()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalAppRequest {
    executable: String,
    args: Vec<String>,
    working_directory: Option<String>,
    file: String,
    line: Option<u32>,
}

fn expand_external_app_value(value: &str, file: &Path, line: u32) -> Result<String, String> {
    let directory = file.parent().unwrap_or_else(|| Path::new(""));
    let expanded = value
        .replace("${file}", &file.to_string_lossy())
        .replace("${dir}", &directory.to_string_lossy())
        .replace("${line}", &line.to_string());
    if expanded.contains("${") {
        return Err(format!(
            "Unsupported placeholder in external application value: {value}"
        ));
    }
    Ok(expanded)
}

#[tauri::command]
pub fn open_external_app(request: OpenExternalAppRequest) -> Result<(), String> {
    let file = PathBuf::from(&request.file);
    if !file.exists() {
        return Err(AppError::FileNotFound(request.file).to_string());
    }
    if request.executable.trim().is_empty() {
        return Err("External application executable is required.".into());
    }
    let line = request.line.unwrap_or(1);
    let executable = expand_external_app_value(&request.executable, &file, line)?;
    let mut command = std::process::Command::new(&executable);
    for argument in request.args {
        command.arg(expand_external_app_value(&argument, &file, line)?);
    }
    if let Some(working_directory) = request
        .working_directory
        .filter(|value| !value.trim().is_empty())
    {
        command.current_dir(expand_external_app_value(&working_directory, &file, line)?);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not start {executable}: {error}"))?;
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
    fn vscode_opens_the_containing_folder_before_the_markdown_file() {
        let file = Path::new("C:/docs/readme.md");
        let arguments = editor_arguments("vscode", file).unwrap();

        assert_eq!(arguments, vec![std::ffi::OsString::from("C:/docs"), std::ffi::OsString::from("C:/docs/readme.md")]);
    }

    #[test]
    fn adjacent_window_prefers_the_right_of_its_source() {
        let area = WorkArea { x: 0, y: 0, width: 1920, height: 1080 };
        let source = WindowGeometry { x: 100, y: 120, width: 800, height: 600 };

        assert_eq!(
            adjacent_geometry(source, 820, area),
            WindowGeometry { x: 920, y: 120, width: 800, height: 600 },
        );
    }

    #[test]
    fn adjacent_window_uses_the_left_when_right_would_overflow() {
        let area = WorkArea { x: 0, y: 0, width: 1920, height: 1080 };
        let source = WindowGeometry { x: 1100, y: 120, width: 800, height: 600 };

        assert_eq!(
            adjacent_geometry(source, 820, area),
            WindowGeometry { x: 300, y: 120, width: 800, height: 600 },
        );
    }

    #[test]
    fn saved_geometry_outside_all_displays_is_clamped_to_a_work_area() {
        let area = WorkArea { x: 0, y: 0, width: 1200, height: 800 };
        let restored = clamp_geometry_to_area(
            WindowGeometry { x: 5000, y: -200, width: 1600, height: 900 },
            area,
        );

        assert_eq!(restored, WindowGeometry { x: 0, y: 0, width: 1200, height: 800 });
    }
}
