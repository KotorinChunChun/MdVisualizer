use crate::app_state::AppState;
use base64::Engine;
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
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

static CLIPBOARD_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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

const MIN_ADJACENT_WINDOW_OUTER_WIDTH: u32 = 200;

fn physical_width(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn logical_geometry(geometry: WindowGeometry, scale_factor: f64) -> (f64, f64, f64, f64) {
    let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    (
        geometry.width as f64 / scale_factor,
        geometry.height as f64 / scale_factor,
        geometry.x as f64 / scale_factor,
        geometry.y as f64 / scale_factor,
    )
}

fn geometry_from_window(window: &WebviewWindow) -> Result<WindowGeometry, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    Ok(WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn geometry_from_native_window(window: &tauri::Window) -> Result<WindowGeometry, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    Ok(WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
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
    let right = geometry.x.saturating_add(physical_width(geometry.width));
    let bottom = geometry.y.saturating_add(physical_width(geometry.height));
    let area_right = area.x.saturating_add(physical_width(area.width));
    let area_bottom = area.y.saturating_add(physical_width(area.height));
    geometry.x < area_right && right > area.x && geometry.y < area_bottom && bottom > area.y
}

fn clamp_geometry_to_area(mut geometry: WindowGeometry, area: WorkArea) -> WindowGeometry {
    geometry.width = geometry.width.min(area.width.max(1));
    geometry.height = geometry.height.min(area.height.max(1));
    let max_x = area
        .x
        .saturating_add(physical_width(area.width.saturating_sub(geometry.width)));
    let max_y = area
        .y
        .saturating_add(physical_width(area.height.saturating_sub(geometry.height)));
    geometry.x = geometry.x.clamp(area.x, max_x);
    geometry.y = geometry.y.clamp(area.y, max_y);
    geometry
}

fn adjacent_geometry(
    source: WindowGeometry,
    source_outer_width: u32,
    area: WorkArea,
) -> WindowGeometry {
    let source_outer_width = source_outer_width.max(source.width);
    let source_right = source.x.saturating_add(physical_width(source_outer_width));
    let area_right = area.x.saturating_add(physical_width(area.width));
    let right_space = area_right.saturating_sub(source_right).max(0) as u32;
    let left_space = source.x.saturating_sub(area.x).max(0) as u32;

    if let Some(geometry) =
        adjacent_geometry_in_space(source, source_outer_width, right_space, source_right, area)
    {
        return geometry;
    }
    if let Some(geometry) =
        adjacent_geometry_in_space(source, source_outer_width, left_space, source.x, area)
    {
        return geometry;
    }

    // Keep the previous cascade/clamp behavior when neither adjacent side has
    // enough room for a usable window.
    let x = if source_right.saturating_add(physical_width(source.width)) <= area_right {
        source_right
    } else {
        source.x.saturating_sub(physical_width(source.width))
    };
    clamp_geometry_to_area(
        WindowGeometry {
            x,
            y: source.y,
            width: source.width,
            height: source.height,
        },
        area,
    )
}

fn adjacent_geometry_in_space(
    source: WindowGeometry,
    source_outer_width: u32,
    available_outer_width: u32,
    edge: i32,
    area: WorkArea,
) -> Option<WindowGeometry> {
    if available_outer_width < MIN_ADJACENT_WINDOW_OUTER_WIDTH {
        return None;
    }
    let outer_width = source_outer_width.min(available_outer_width);
    let frame_width = source_outer_width.saturating_sub(source.width);
    let width = outer_width.saturating_sub(frame_width).max(1);
    let x = if edge == source.x {
        source.x.saturating_sub(physical_width(outer_width))
    } else {
        edge
    };
    Some(clamp_geometry_to_area(
        WindowGeometry {
            x,
            y: source.y,
            width,
            height: source.height,
        },
        area,
    ))
}

fn saved_window_geometry(app_handle: &AppHandle) -> Result<Option<WindowGeometry>, String> {
    let settings =
        load_settings_file(&settings_path(app_handle)?).map_err(|error| error.to_string())?;
    match settings.get("windowGeometry") {
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|error| format!("Saved window geometry is invalid: {error}")),
        None => Ok(None),
    }
}

pub fn restore_saved_window_geometry(
    app_handle: &AppHandle,
    window: &WebviewWindow,
) -> Result<(), String> {
    let Some(saved) = saved_window_geometry(app_handle)? else {
        return Ok(());
    };
    if saved.width == 0 || saved.height == 0 {
        return Ok(());
    }
    let areas = work_areas(window)?;
    let geometry = if areas.iter().any(|area| geometry_is_visible(saved, *area)) {
        saved
    } else {
        let fallback = areas
            .first()
            .copied()
            .ok_or_else(|| "No display is available.".to_string())?;
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
    let source_outer_width = window
        .outer_size()
        .map_err(|error| error.to_string())?
        .width;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let area = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|monitor| {
            let area = monitor.work_area();
            WorkArea {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .ok_or_else(|| "No display is available.".to_string())?;
    let geometry = adjacent_geometry(source, source_outer_width, area);
    let (width, height, x, y) = logical_geometry(geometry, scale_factor);

    // On Windows, building a webview window from a synchronous command can
    // deadlock. Async commands run on Tauri's async worker thread.
    if let Err(error) =
        WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App("index.html".into()))
            .title("MarkdownViewer")
            .inner_size(width, height)
            .position(x, y)
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

const POWERSHELL_SOURCE_LIMIT: usize = 256 * 1024;
const POWERSHELL_OUTPUT_LIMIT: u64 = 1024 * 1024;
const POWERSHELL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPowerShellRequest {
    document_path: String,
    language: String,
    source: String,
    working_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellRunResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    truncated: bool,
    duration_ms: u64,
}

struct ValidatedPowerShellRequest {
    working_directory: PathBuf,
    source: String,
}

fn validate_powershell_request(
    request: RunPowerShellRequest,
) -> Result<ValidatedPowerShellRequest, String> {
    if !matches!(
        request.language.trim().to_ascii_lowercase().as_str(),
        "powershell" | "pwsh" | "ps1"
    ) {
        return Err("Only powershell, pwsh, and ps1 code blocks can be executed.".into());
    }
    if request.source.trim().is_empty() {
        return Err("PowerShell source is empty.".into());
    }
    if request.source.len() > POWERSHELL_SOURCE_LIMIT {
        return Err(format!(
            "PowerShell source exceeds the {POWERSHELL_SOURCE_LIMIT} byte limit."
        ));
    }
    let document_path = std::fs::canonicalize(&request.document_path)
        .map_err(|error| format!("Could not resolve Markdown document path: {error}"))?;
    if !document_path.is_file() {
        return Err("The Markdown document path is not a file.".into());
    }
    let is_markdown = document_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        });
    if !is_markdown {
        return Err("PowerShell code can only be executed from a Markdown document.".into());
    }
    let default_working_directory = document_path
        .parent()
        .ok_or_else(|| "The Markdown document has no containing directory.".to_string())?
        .to_path_buf();
    let working_directory = match request.working_directory.filter(|directory| !directory.trim().is_empty()) {
        Some(directory) => std::fs::canonicalize(&directory)
            .map_err(|error| format!("Could not resolve working directory: {error}"))?,
        None => default_working_directory,
    };
    if !working_directory.is_dir() {
        return Err("The working directory is not a directory.".into());
    }
    Ok(ValidatedPowerShellRequest {
        working_directory,
        source: request.source,
    })
}

fn read_limited_output<R: Read + Send + 'static>(
    reader: R,
) -> std::thread::JoinHandle<Result<(String, bool), String>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        reader
            .take(POWERSHELL_OUTPUT_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Could not read PowerShell output: {error}"))?;
        let truncated = bytes.len() as u64 > POWERSHELL_OUTPUT_LIMIT;
        if truncated {
            bytes.truncate(POWERSHELL_OUTPUT_LIMIT as usize);
        }
        Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
    })
}

fn run_powershell_process(
    request: ValidatedPowerShellRequest,
    timeout: Duration,
) -> Result<PowerShellRunResult, String> {
    let started = Instant::now();
    let utf8_preamble = "$OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $PSStyle.OutputRendering = 'PlainText'; ";
    let encoded_source = utf8_preamble.to_owned() + &request.source;
    let encoded_command = base64::engine::general_purpose::STANDARD.encode(
        encoded_source
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let mut command = Command::new("pwsh");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded_command,
        ])
        .current_dir(&request.working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "PowerShell 7 (pwsh) が見つかりません。Microsoft Store から『PowerShell』をインストールしてから再実行してください。".to_string()
            } else {
                format!("Could not start pwsh: {error}")
            }
        })?;
    let stdout_reader = read_limited_output(
        child
            .stdout
            .take()
            .ok_or_else(|| "PowerShell stdout was unavailable.".to_string())?,
    );
    let stderr_reader = read_limited_output(
        child
            .stderr
            .take()
            .ok_or_else(|| "PowerShell stderr was unavailable.".to_string())?,
    );

    let (status, timed_out) = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Could not query pwsh status: {error}"))?
        {
            break (status, false);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let status = child
                .wait()
                .map_err(|error| format!("Could not stop timed out pwsh: {error}"))?;
            break (status, true);
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "PowerShell stdout reader stopped unexpectedly.".to_string())??;
    let (stderr, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "PowerShell stderr reader stopped unexpectedly.".to_string())??;
    Ok(PowerShellRunResult {
        stdout,
        stderr,
        exit_code: status.code(),
        timed_out,
        truncated: stdout_truncated || stderr_truncated,
        duration_ms: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
    })
}

#[tauri::command]
pub async fn run_powershell(request: RunPowerShellRequest) -> Result<PowerShellRunResult, String> {
    let validated = validate_powershell_request(request)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_powershell_process(validated, POWERSHELL_TIMEOUT)
    })
    .await
    .map_err(|error| format!("PowerShell worker failed: {error}"))?
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
            Duration::from_secs(5),
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
}
