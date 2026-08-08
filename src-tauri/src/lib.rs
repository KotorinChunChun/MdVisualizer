pub mod app_state;
pub mod backup;
pub mod commands;
pub mod errors;
pub mod file_lock;
pub mod image_ops;
pub mod image_references;
pub mod markdown;
pub mod settings;
pub mod watcher;

use app_state::AppState;
use commands::*;
use tauri::{Emitter, Manager};

fn markdown_file_arguments(arguments: impl IntoIterator<Item = String>) -> Vec<String> {
    arguments
        .into_iter()
        .filter(|argument| {
            !argument.starts_with('-')
                && (argument.to_lowercase().ends_with(".md")
                    || argument.to_lowercase().ends_with(".markdown"))
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial_files = markdown_file_arguments(args.into_iter().skip(1));

    let state = AppState::new(initial_files).expect("Failed to initialize AppState");

    tauri::Builder::default()
        // This plugin must be first: a second file-association launch is
        // delivered to the existing app instead of becoming an overlapping
        // second process.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let files = markdown_file_arguments(args);
            if !files.is_empty() {
                let target = app
                    .get_webview_window("main")
                    .or_else(|| app.webview_windows().into_values().next());
                if let Some(window) = target {
                    let _ = window.emit("open-markdown-in-new-window", files);
                }
            }
        }))
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
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::markdown_file_arguments;

    #[test]
    fn keeps_only_markdown_file_arguments() {
        assert_eq!(
            markdown_file_arguments([
                "MarkdownViewer.exe".into(),
                "--flag".into(),
                "C:/docs/readme.md".into(),
                "C:/docs/notes.MARKDOWN".into(),
                "C:/docs/image.png".into(),
            ]),
            vec!["C:/docs/readme.md", "C:/docs/notes.MARKDOWN"],
        );
    }
}
