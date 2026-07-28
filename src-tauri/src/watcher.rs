use crate::errors::{AppError, AppResult};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
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
    window_targets: Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>,
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn new(app_handle: AppHandle) -> AppResult<Self> {
        let (tx_event, rx_event) = channel::<PathBuf>();
        let watched_paths = Arc::new(Mutex::new(HashSet::new()));
        let window_targets = Arc::new(Mutex::new(HashMap::<String, HashSet<PathBuf>>::new()));

        let window_targets_clone = Arc::clone(&window_targets);
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
                    let targets = window_targets_clone.lock().unwrap();
                    let owners: Vec<String> = targets
                        .iter()
                        .filter_map(|(label, paths)| paths.contains(&path).then(|| label.clone()))
                        .collect();
                    if !owners.is_empty() {
                        let path_str = path.to_string_lossy().to_string();
                        let payload = FileChangedPayload {
                            path: path_str.clone(),
                        };

                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_lowercase();

                        for label in owners {
                            if ext == "md" || ext == "markdown" {
                                let _ = app_handle_clone.emit_to(&label, "markdown-changed", payload.clone());
                            } else {
                                let _ = app_handle_clone.emit_to(&label, "image-changed", payload.clone());
                            }
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
                        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {
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
            window_targets,
            _watcher: watcher,
        })
    }

    pub fn set_watch_targets(&mut self, main_md: &str, image_paths: &[String]) -> AppResult<()> {
        let mut targets = vec![main_md.to_owned()];
        targets.extend(image_paths.iter().cloned());
        self.sync_window_targets("main", &targets)
    }

    /// Replaces only one window's target set, preserving every other window's watches.
    pub fn sync_window_targets(&mut self, window_label: &str, targets: &[String]) -> AppResult<()> {
        let normalized: HashSet<PathBuf> = targets
            .iter()
            .map(|target| {
                let path = PathBuf::from(target);
                path.canonicalize().unwrap_or(path)
            })
            .collect();
        self.window_targets
            .lock()
            .unwrap()
            .insert(window_label.to_owned(), normalized);
        self.reconcile_watches()
    }

    pub fn remove_window_targets(&mut self, window_label: &str) -> AppResult<()> {
        self.window_targets.lock().unwrap().remove(window_label);
        self.reconcile_watches()
    }

    fn reconcile_watches(&mut self) -> AppResult<()> {
        let desired = desired_watch_paths(&self.window_targets.lock().unwrap());
        let mut watched = self.watched_paths.lock().unwrap();

        for path in watched.difference(&desired) {
            let _ = self._watcher.unwatch(path);
        }
        for path in desired.difference(&watched.clone()) {
            if path.exists() {
                self._watcher
                    .watch(path, RecursiveMode::NonRecursive)
                    .map_err(|e| AppError::WatchError(e.to_string()))?;
            }
        }
        *watched = desired;
        Ok(())
    }

    pub fn stop(&mut self) {
        self.window_targets.lock().unwrap().clear();
        let mut watched = self.watched_paths.lock().unwrap();
        for p in watched.iter() {
            let _ = self._watcher.unwatch(p);
        }
        watched.clear();
    }
}

fn desired_watch_paths(window_targets: &HashMap<String, HashSet<PathBuf>>) -> HashSet<PathBuf> {
    window_targets.values().flat_map(|paths| paths.iter().cloned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watch_set_is_the_union_of_all_window_targets() {
        let mut targets = HashMap::new();
        targets.insert("main".into(), HashSet::from([PathBuf::from("a.md"), PathBuf::from("shared.png")]));
        targets.insert("viewer-1".into(), HashSet::from([PathBuf::from("b.md"), PathBuf::from("shared.png")]));
        assert_eq!(desired_watch_paths(&targets), HashSet::from([PathBuf::from("a.md"), PathBuf::from("b.md"), PathBuf::from("shared.png")]));
    }

    #[test]
    fn removing_one_window_preserves_paths_owned_by_another() {
        let mut targets = HashMap::new();
        targets.insert("main".into(), HashSet::from([PathBuf::from("shared.md")]));
        targets.insert("viewer-1".into(), HashSet::from([PathBuf::from("shared.md"), PathBuf::from("other.md")]));
        targets.remove("main");
        assert_eq!(desired_watch_paths(&targets), HashSet::from([PathBuf::from("shared.md"), PathBuf::from("other.md")]));
    }
}
