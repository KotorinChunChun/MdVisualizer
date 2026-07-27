use crate::errors::{AppError, AppResult};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Debug)]
pub struct FileChangedPayload {
    pub path: String,
}

pub struct FileWatcher {
    _app_handle: AppHandle,
    _tx: Sender<PathBuf>,
    watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn new(app_handle: AppHandle) -> AppResult<Self> {
        let (tx_event, rx_event) = channel::<PathBuf>();
        let watched_paths = Arc::new(Mutex::new(HashSet::new()));

        let watched_paths_clone = Arc::clone(&watched_paths);
        let app_handle_clone = app_handle.clone();

        // デバウンス処理ワーカースレッド
        thread::spawn(move || {
            let mut pending_changes: std::collections::HashMap<PathBuf, Instant> =
                std::collections::HashMap::new();
            let debounce_duration = Duration::from_millis(300);

            loop {
                // チャンネルからの新規変更通知を受信
                while let Ok(path) = rx_event.recv_timeout(Duration::from_millis(50)) {
                    pending_changes.insert(path, Instant::now());
                }

                let now = Instant::now();
                let mut ready_paths = Vec::new();

                pending_changes.retain(|path, last_time| {
                    if now.duration_since(*last_time) >= debounce_duration {
                        ready_paths.push(path.clone());
                        false
                    } else {
                        true
                    }
                });

                for path in ready_paths {
                    let watched = watched_paths_clone.lock().unwrap();
                    if watched.contains(&path) || watched.iter().any(|p| p == &path) {
                        let path_str = path.to_string_lossy().to_string();
                        let payload = FileChangedPayload {
                            path: path_str.clone(),
                        };

                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_lowercase();

                        if ext == "md" || ext == "markdown" {
                            let _ = app_handle_clone.emit("markdown-changed", payload);
                        } else {
                            let _ = app_handle_clone.emit("image-changed", payload);
                        }
                    }
                }

                thread::sleep(Duration::from_millis(50));
            }
        });

        let tx_for_watcher = tx_event.clone();

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) => {
                            for path in event.paths {
                                let canonical = path.canonicalize().unwrap_or(path);
                                let _ = tx_for_watcher.send(canonical);
                            }
                        }
                        _ => {}
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| AppError::WatchError(e.to_string()))?;

        Ok(Self {
            _app_handle: app_handle,
            _tx: tx_event,
            watched_paths,
            _watcher: watcher,
        })
    }

    pub fn set_watch_targets(&mut self, main_md: &str, image_paths: &[String]) -> AppResult<()> {
        let mut watched = self.watched_paths.lock().unwrap();

        for p in watched.iter() {
            let _ = self._watcher.unwatch(p);
        }
        watched.clear();

        let md_path = PathBuf::from(main_md);
        let canonical_md = md_path.canonicalize().unwrap_or(md_path);
        if canonical_md.exists() {
            if let Err(e) = self._watcher.watch(&canonical_md, RecursiveMode::NonRecursive) {
                eprintln!("Failed to watch md file: {:?}", e);
            }
            watched.insert(canonical_md);
        }

        for img in image_paths {
            let p = PathBuf::from(img);
            let canonical_img = p.canonicalize().unwrap_or(p);
            if canonical_img.exists() {
                if let Err(e) = self._watcher.watch(&canonical_img, RecursiveMode::NonRecursive) {
                    eprintln!("Failed to watch image file {:?}: {:?}", img, e);
                }
                watched.insert(canonical_img);
            }
        }

        Ok(())
    }

    pub fn stop(&mut self) {
        let mut watched = self.watched_paths.lock().unwrap();
        for p in watched.iter() {
            let _ = self._watcher.unwatch(p);
        }
        watched.clear();
    }
}
