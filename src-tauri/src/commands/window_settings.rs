use crate::app_state::{AppState, WindowGeometry};
use crate::errors::AppError;
use crate::markdown::is_supported_document;
use crate::settings::{
    load_application_settings, load_settings as load_settings_file, merge_external_app_settings,
    merge_fold_state, merge_settings, SettingsLoadResult,
};
use crate::sharepoint::{is_spmd_uri, parse_spmd_uri};
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

const MIN_ADJACENT_WINDOW_OUTER_WIDTH: u32 = 200;

fn physical_width(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

pub(super) fn logical_geometry(
    geometry: WindowGeometry,
    scale_factor: f64,
) -> (f64, f64, f64, f64) {
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

pub fn window_geometry(window: &WebviewWindow) -> Result<WindowGeometry, String> {
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
    Ok(window
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
        .collect())
}

fn geometry_is_visible(geometry: WindowGeometry, area: WorkArea) -> bool {
    let right = geometry.x.saturating_add(physical_width(geometry.width));
    let bottom = geometry.y.saturating_add(physical_width(geometry.height));
    let area_right = area.x.saturating_add(physical_width(area.width));
    let area_bottom = area.y.saturating_add(physical_width(area.height));
    geometry.x < area_right && right > area.x && geometry.y < area_bottom && bottom > area.y
}

pub(super) fn clamp_geometry_to_area(
    mut geometry: WindowGeometry,
    area: WorkArea,
) -> WindowGeometry {
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

pub(super) fn adjacent_geometry(
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

/// Persists a previously observed geometry without querying a window from its
/// close callback. Calling native window getters while Windows is dispatching
/// `CloseRequested` can re-enter the UI thread and prevent the close request
/// from completing.
pub fn save_window_geometry(app_handle: &AppHandle, geometry: WindowGeometry) -> Result<(), String> {
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
    let remote = is_spmd_uri(&path);
    if remote {
        parse_spmd_uri(&path).map_err(|error| error.to_string())?;
    } else if !is_supported_document(Path::new(&path)) {
        return Err(AppError::UnsupportedDocument(path).to_string());
    }
    if !remote && !Path::new(&path).exists() {
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
    let source = window_geometry(&window)?;
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

    let created_window = match
        WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App("index.html".into()))
            .title("MarkdownViewer")
            .inner_size(width, height)
            .position(x, y)
            .prevent_overflow()
            .build()
    {
        Ok(created_window) => created_window,
        Err(error) => {
            if let Ok(mut initial_files) = state.initial_files.lock() {
                initial_files.remove(&label);
            }
            return Err(error.to_string());
        }
    };
    created_window.show().map_err(|error| error.to_string())?;
    created_window.unminimize().map_err(|error| error.to_string())?;
    created_window.set_focus().map_err(|error| error.to_string())?;
    state
        .window_geometries
        .lock()
        .map_err(|_| "Window geometry state is unavailable.".to_string())?
        .insert(label, geometry);
    Ok(())
}
