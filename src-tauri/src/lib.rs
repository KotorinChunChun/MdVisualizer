pub mod app_state;
pub mod backup;
pub mod commands;
pub mod errors;
pub mod image_ops;
pub mod markdown;
pub mod watcher;

use app_state::AppState;
use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial_file = args.into_iter().skip(1).find(|arg| {
        !arg.starts_with('-')
            && (arg.to_lowercase().ends_with(".md") || arg.to_lowercase().ends_with(".markdown"))
    });

    let state = AppState::new(initial_file).expect("Failed to initialize AppState");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            load_markdown,
            start_watch,
            stop_watch,
            crop_image,
            restore_image,
            open_external_editor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
