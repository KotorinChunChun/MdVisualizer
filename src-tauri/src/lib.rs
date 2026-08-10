pub mod app_state;
pub mod backup;
pub mod commands;
pub mod errors;
pub mod file_lock;
pub mod image_ops;
pub mod image_references;
pub mod markdown;
pub mod settings;
pub mod sharepoint;
pub mod watcher;

use app_state::AppState;
use commands::*;
use markdown::is_supported_document;
use sharepoint::{is_spmd_uri, parse_spmd_uri};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use tauri::{Emitter, EventTarget, Manager};

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
        .manage(state)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let _ = save_window_geometry(&window.app_handle(), window);
            }
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                let mut watcher_guard = state.watcher.lock().unwrap();
                if let Some(watcher) = watcher_guard.as_mut() {
                    let _ = watcher.remove_window_targets(window.label());
                }
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = restore_saved_window_geometry(&app.handle(), &window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            load_settings_status,
            save_settings,
            copy_mermaid_file,
            update_external_app_settings,
            save_fold_state,
            get_initial_files,
            open_in_new_window,
            load_markdown,
            diagnose_document,
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
            open_external_url
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
}
