pub mod app_state;
pub mod asset_staging;
pub mod backup;
pub mod commands;
mod credential_store;
pub mod document_edit;
pub mod errors;
pub mod file_lock;
pub mod image_ops;
pub mod image_references;
pub mod markdown;
pub mod settings;
pub mod sharepoint;
pub mod watcher;

use app_state::AppState;
#[cfg(debug_assertions)]
use app_state::DebugApplicationState;
use commands::*;
use markdown::is_supported_document;
use sharepoint::{is_spmd_uri, parse_spmd_uri};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use tauri::{Emitter, EventTarget, Manager};

#[cfg(debug_assertions)]
const DEBUG_QUERY_STATE_ARGUMENT: &str = "--debug-query-state";

fn lexical_normalize(path: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn normalize_document_path(path: &str, cwd: &Path) -> Option<PathBuf> {
    let path = PathBuf::from(path);
    if !is_supported_document(&path) {
        return None;
    }
    let absolute = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    Some(std::fs::canonicalize(&absolute).unwrap_or_else(|_| lexical_normalize(absolute)))
}

fn path_deduplication_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    #[cfg(target_os = "windows")]
    let value = value.to_lowercase();
    value
}

fn document_launch_arguments(arguments: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    let mut seen = HashSet::new();
    arguments
        .into_iter()
        .filter(|argument| !argument.starts_with('-'))
        .filter_map(|argument| {
            if is_spmd_uri(&argument) {
                parse_spmd_uri(&argument).ok().map(|parsed| parsed.canonical_uri)
            } else {
                normalize_document_path(&argument, cwd)
                    .map(|path| path.to_string_lossy().into_owned())
            }
        })
        .filter(|source| {
            let key = if is_spmd_uri(source) {
                source.to_ascii_lowercase()
            } else {
                path_deduplication_key(Path::new(source))
            };
            seen.insert(key)
        })
        .collect()
}

fn launch_owner_label(labels: impl IntoIterator<Item = String>) -> Option<String> {
    let mut labels = labels.into_iter().collect::<Vec<_>>();
    labels.sort();
    labels
        .iter()
        .find(|label| label.as_str() == "main")
        .cloned()
        .or_else(|| labels.into_iter().next())
}

#[cfg(debug_assertions)]
fn debug_query_response_path(arguments: &[String], cwd: &Path) -> Option<PathBuf> {
    let value = arguments
        .windows(2)
        .find(|pair| pair[0] == DEBUG_QUERY_STATE_ARGUMENT)?
        .get(1)?;
    let candidate = PathBuf::from(value);
    let candidate = lexical_normalize(if candidate.is_absolute() {
        candidate
    } else {
        cwd.join(candidate)
    });
    let temp = lexical_normalize(std::env::temp_dir());
    if candidate
        .parent()
        .map(path_deduplication_key)
        .as_deref()
        != Some(path_deduplication_key(&temp).as_str())
    {
        return None;
    }
    let filename = candidate.file_name()?.to_str()?;
    if !filename.starts_with("markdownviewer-debug-state-")
        || candidate.extension().and_then(|value| value.to_str()) != Some("json")
    {
        return None;
    }
    Some(candidate)
}

#[cfg(debug_assertions)]
fn write_debug_application_state(app: &tauri::AppHandle, response_path: &Path) -> Result<(), String> {
    use std::io::Write;

    let state = app.state::<AppState>();
    let mut windows = state
        .debug_windows
        .lock()
        .map_err(|_| "Debug window state is unavailable.".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    windows.sort_by(|left, right| left.label.cmp(&right.label));
    let snapshot = DebugApplicationState {
        process_id: std::process::id(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        windows,
    };
    let parent = response_path
        .parent()
        .ok_or_else(|| "Debug response directory is unavailable.".to_string())?;
    let mut output = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(output.as_file_mut(), &snapshot)
        .map_err(|error| error.to_string())?;
    output
        .as_file_mut()
        .write_all(b"\n")
        .map_err(|error| error.to_string())?;
    output
        .persist_noclobber(response_path)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial_files = document_launch_arguments(
        args.into_iter().skip(1),
        &std::env::current_dir().expect("Could not determine the current directory"),
    );

    let state = AppState::new(initial_files).expect("Failed to initialize AppState");

    tauri::Builder::default()
        // This plugin must be first: a second file-association launch is
        // delivered to the existing app instead of becoming an overlapping
        // second process.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            #[cfg(debug_assertions)]
            if let Some(response_path) = debug_query_response_path(&args, Path::new(&cwd)) {
                let _ = write_debug_application_state(app, &response_path);
                return;
            }
            let files = document_launch_arguments(args, Path::new(&cwd));
            if !files.is_empty() {
                let labels = app.webview_windows().into_keys();
                if let Some(label) = launch_owner_label(labels) {
                    // Emitter::emit is app-wide even when called on a
                    // WebviewWindow. Target this WebviewWindow explicitly so
                    // every open viewer does not process the same launch.
                    let Some(window) = app.get_webview_window(&label) else {
                        return;
                    };
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit_to(
                        EventTarget::webview_window(label),
                        "open-markdown-in-new-window",
                        files,
                    );
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .on_window_event(|window, event| {
            let state = window.state::<AppState>();
            match event {
                tauri::WindowEvent::Moved(position) => {
                    if let Ok(mut geometries) = state.window_geometries.lock() {
                        if let Some(geometry) = geometries.get_mut(window.label()) {
                            geometry.x = position.x;
                            geometry.y = position.y;
                        }
                    }
                }
                tauri::WindowEvent::Resized(size) => {
                    if let Ok(mut geometries) = state.window_geometries.lock() {
                        if let Some(geometry) = geometries.get_mut(window.label()) {
                            geometry.width = size.width;
                            geometry.height = size.height;
                        }
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if let Ok(mut windows) = state.debug_windows.lock() {
                        windows.remove(window.label());
                    }
                    let geometry = state
                        .window_geometries
                        .lock()
                        .ok()
                        .and_then(|mut geometries| geometries.remove(window.label()));
                    if let Some(geometry) = geometry {
                        let _ = save_window_geometry(&window.app_handle(), geometry);
                    }
                    let mut watcher_guard = state.watcher.lock().unwrap();
                    if let Some(watcher) = watcher_guard.as_mut() {
                        let _ = watcher.remove_window_targets(window.label());
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = restore_saved_window_geometry(&app.handle(), &window);
                if let Ok(geometry) = window_geometry(&window) {
                    let state = app.state::<AppState>();
                    if let Ok(mut geometries) = state.window_geometries.lock() {
                        geometries.insert(window.label().to_string(), geometry);
                    };
                }
                // The main window is created hidden so the default size never
                // flashes before the persisted geometry has been restored.
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            load_settings_status,
            save_settings,
            load_markdown_style,
            save_markdown_style,
            open_markdown_style,
            copy_mermaid_file,
            copy_text_file,
            update_external_app_settings,
            save_fold_state,
            get_initial_files,
            open_in_new_window,
            load_markdown,
            create_markdown,
            save_markdown,
            save_table_csv,
            stage_document_asset,
            update_staged_text_asset,
            stage_clipboard_image,
            discard_staged_assets,
            read_document_asset,
            save_sharepoint_asset,
            diagnose_document,
            document_watch_targets,
            start_watch,
            stop_watch,
            sync_watch_targets,
            remove_window_watch_targets,
            crop_image,
            save_rendered_image,
            restore_image,
            has_image_backup,
            update_image_caption,
            rename_image_and_references,
            open_external_editor,
            open_containing_folder,
            open_in_editor,
            open_external_app,
            run_powershell,
            open_external_url,
            report_debug_window_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{document_launch_arguments, launch_owner_label};
    use std::path::Path;

    #[test]
    fn keeps_only_supported_document_arguments() {
        assert_eq!(
            document_launch_arguments(
                [
                    "MarkdownViewer.exe".into(),
                    "--flag".into(),
                    "C:/docs/readme.md".into(),
                    "C:/docs/notes.MARKDOWN".into(),
                    "C:/docs/diagram.svg".into(),
                    "C:/docs/flow.mmd".into(),
                    "C:/docs/sequence.MERMAID".into(),
                    "C:/docs/system.drawio".into(),
                    "C:/docs/image.png".into(),
                ],
                Path::new("C:/")
            ),
            vec![
                "C:\\docs\\readme.md",
                "C:\\docs\\notes.MARKDOWN",
                "C:\\docs\\diagram.svg",
                "C:\\docs\\flow.mmd",
                "C:\\docs\\sequence.MERMAID",
                "C:\\docs\\system.drawio",
            ],
        );
    }

    #[test]
    fn normalizes_and_deduplicates_paths_in_one_launch_request() {
        assert_eq!(
            document_launch_arguments(
                [
                    "docs/./guide.md".into(),
                    "docs/section/../guide.md".into(),
                    "docs/other.md".into(),
                ],
                Path::new("C:/workspace"),
            ),
            vec![
                "C:\\workspace\\docs\\guide.md",
                "C:\\workspace\\docs\\other.md"
            ],
        );
    }

    #[test]
    fn accepts_and_deduplicates_valid_spmd_launches() {
        let source = "spmd://excelchunchun.sharepoint.com/sites/msteams_fcce9d/Shared%20Documents/md/README.md";
        assert_eq!(
            document_launch_arguments([source.into(), source.to_ascii_uppercase()], Path::new("C:/")),
            vec![source]
        );
        assert!(document_launch_arguments(
            ["spmd://example.com/sites/a/docs/readme.md".into()],
            Path::new("C:/")
        )
        .is_empty());
    }

    #[test]
    fn chooses_only_one_deterministic_launch_owner() {
        assert_eq!(
            launch_owner_label(["viewer-2".into(), "main".into(), "viewer-1".into()]),
            Some("main".into()),
        );
        assert_eq!(
            launch_owner_label(["viewer-2".into(), "viewer-1".into()]),
            Some("viewer-1".into()),
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn limits_debug_state_responses_to_unique_json_files_in_the_temp_directory() {
        use super::debug_query_response_path;

        let allowed = std::env::temp_dir().join("markdownviewer-debug-state-test.json");
        assert_eq!(
            debug_query_response_path(
                &["MarkdownViewer.exe".into(), "--debug-query-state".into(), allowed.to_string_lossy().into_owned()],
                Path::new("C:/workspace")
            ),
            Some(allowed)
        );
        assert!(debug_query_response_path(
            &["MarkdownViewer.exe".into(), "--debug-query-state".into(), "C:/workspace/state.json".into()],
            Path::new("C:/workspace")
        )
        .is_none());
    }
}
