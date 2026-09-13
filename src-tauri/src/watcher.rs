use crate::errors::{AppError, AppResult};
use crate::markdown::is_supported_document;
use notify::event::{ModifyKind, RenameMode};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FileChangeKind {
    Modified,
    Created,
    Deleted,
    Renamed,
    Replaced,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedPayload {
    pub window_label: String,
    pub path: String,
    pub change_kind: FileChangeKind,
}

#[derive(Clone, Debug)]
struct RawChange {
    paths: Vec<PathBuf>,
    kind: FileChangeKind,
}

pub struct FileWatcher {
    _app_handle: AppHandle,
    _tx: Sender<RawChange>,
    watched_roots: HashSet<PathBuf>,
    window_targets: Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>,
    watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn new(app_handle: AppHandle) -> AppResult<Self> {
        let (tx_event, rx_event) = channel::<RawChange>();
        let window_targets = Arc::new(Mutex::new(HashMap::<String, HashSet<PathBuf>>::new()));
        let targets_for_worker = Arc::clone(&window_targets);
        let app_handle_for_worker = app_handle.clone();

        // Watching parent directories keeps a subscription alive when editors
        // replace a file by renaming a temporary file over it.
        thread::spawn(move || {
            let mut pending: HashMap<PathBuf, (FileChangeKind, Instant)> = HashMap::new();
            const DEBOUNCE: Duration = Duration::from_millis(300);
            loop {
                while let Ok(change) = rx_event.recv_timeout(Duration::from_millis(50)) {
                    let tracked: Vec<PathBuf> = targets_for_worker
                        .lock()
                        .map(|targets| {
                            targets
                                .values()
                                .flat_map(|paths| paths.iter().cloned())
                                .collect()
                        })
                        .unwrap_or_default();
                    for target in tracked {
                        if change.paths.iter().any(|path| paths_match(path, &target)) {
                            pending
                                .entry(target)
                                .and_modify(|(existing, updated)| {
                                    *existing = merge_change_kind(*existing, change.kind);
                                    *updated = Instant::now();
                                })
                                .or_insert((change.kind, Instant::now()));
                        }
                    }
                }

                let now = Instant::now();
                let ready: Vec<(PathBuf, FileChangeKind)> = pending
                    .iter()
                    .filter_map(|(path, (kind, updated))| {
                        (now.duration_since(*updated) >= DEBOUNCE).then(|| (path.clone(), *kind))
                    })
                    .collect();
                for (path, kind) in ready {
                    pending.remove(&path);
                    let owners: Vec<String> = targets_for_worker
                        .lock()
                        .map(|targets| {
                            targets
                                .iter()
                                .filter_map(|(label, paths)| {
                                    paths.contains(&path).then(|| label.clone())
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let is_document = is_supported_document(&path);
                    for label in owners {
                        let payload = FileChangedPayload {
                            window_label: label.clone(),
                            path: path.to_string_lossy().to_string(),
                            change_kind: kind,
                        };
                        let event = if is_document {
                            "markdown-changed"
                        } else {
                            "image-changed"
                        };
                        let _ = app_handle_for_worker.emit_to(&label, event, payload);
                    }
                }
            }
        });

        let tx_for_watcher = tx_event.clone();
        let watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    if let Some(kind) = classify_event(&event) {
                        let _ = tx_for_watcher.send(RawChange {
                            paths: event.paths,
                            kind,
                        });
                    }
                }
            },
            Config::default(),
        )
        .map_err(|error| AppError::WatchError(error.to_string()))?;

        Ok(Self {
            _app_handle: app_handle,
            _tx: tx_event,
            watched_roots: HashSet::new(),
            window_targets,
            watcher,
        })
    }

    pub fn set_watch_targets(&mut self, main_md: &str, image_paths: &[String]) -> AppResult<()> {
        let mut targets = vec![main_md.to_owned()];
        targets.extend(image_paths.iter().cloned());
        self.sync_window_targets("main", &targets)
    }

    /// Replaces one window's target set, preserving watches owned by every
    /// other window (including another window viewing the same file).
    pub fn sync_window_targets(&mut self, window_label: &str, targets: &[String]) -> AppResult<()> {
        let normalized = targets
            .iter()
            .map(|target| normalize_path(target))
            .collect();
        self.window_targets
            .lock()
            .map_err(|_| AppError::WatchError("watch target lock poisoned".into()))?
            .insert(window_label.to_owned(), normalized);
        self.reconcile_watches()
    }

    pub fn remove_window_targets(&mut self, window_label: &str) -> AppResult<()> {
        self.window_targets
            .lock()
            .map_err(|_| AppError::WatchError("watch target lock poisoned".into()))?
            .remove(window_label);
        self.reconcile_watches()
    }

    fn reconcile_watches(&mut self) -> AppResult<()> {
        let targets = self
            .window_targets
            .lock()
            .map_err(|_| AppError::WatchError("watch target lock poisoned".into()))?
            .clone();
        let desired = desired_watch_roots(&targets);
        let removed: Vec<PathBuf> = self.watched_roots.difference(&desired).cloned().collect();
        let added: Vec<PathBuf> = desired.difference(&self.watched_roots).cloned().collect();
        for root in removed {
            let _ = self.watcher.unwatch(&root);
        }
        for root in added {
            if root.exists() {
                self.watcher
                    .watch(&root, RecursiveMode::NonRecursive)
                    .map_err(|error| AppError::WatchError(error.to_string()))?;
            }
        }
        self.watched_roots = desired;
        Ok(())
    }

    /// Legacy all-window stop. Commands should prefer `remove_window_targets`.
    pub fn stop(&mut self) {
        if let Ok(mut targets) = self.window_targets.lock() {
            targets.clear();
        }
        for root in self.watched_roots.drain() {
            let _ = self.watcher.unwatch(&root);
        }
    }
}

fn classify_event(event: &Event) -> Option<FileChangeKind> {
    match event.kind {
        EventKind::Remove(_) => Some(FileChangeKind::Deleted),
        EventKind::Create(_) => Some(FileChangeKind::Created),
        EventKind::Modify(ModifyKind::Name(rename_mode)) => {
            let source_is_temp = event
                .paths
                .first()
                .is_some_and(|path| is_temporary_path(path));
            match rename_mode {
                // Windows commonly reports only the destination (`To`) for an
                // editor's temp-file-overwrite save. With no source path it is
                // safest to treat it as a replacement so auto-reload runs.
                RenameMode::To => Some(FileChangeKind::Replaced),
                RenameMode::Both if source_is_temp => Some(FileChangeKind::Replaced),
                _ => Some(FileChangeKind::Renamed),
            }
        }
        EventKind::Modify(_) => Some(FileChangeKind::Modified),
        _ => None,
    }
}

fn merge_change_kind(previous: FileChangeKind, next: FileChangeKind) -> FileChangeKind {
    match (previous, next) {
        (FileChangeKind::Deleted, FileChangeKind::Created | FileChangeKind::Modified)
        | (FileChangeKind::Created, FileChangeKind::Deleted) => FileChangeKind::Replaced,
        (_, FileChangeKind::Replaced) | (_, FileChangeKind::Renamed) => next,
        (FileChangeKind::Replaced, _) => FileChangeKind::Replaced,
        (_, FileChangeKind::Deleted) => FileChangeKind::Deleted,
        (_, kind) => kind,
    }
}

fn normalize_path(path: &str) -> PathBuf {
    let path = PathBuf::from(path);
    path.canonicalize().unwrap_or(path)
}

fn paths_match(event_path: &Path, target: &Path) -> bool {
    let event_path = event_path
        .canonicalize()
        .unwrap_or_else(|_| event_path.to_path_buf());
    #[cfg(windows)]
    {
        event_path
            .to_string_lossy()
            .eq_ignore_ascii_case(&target.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        event_path == target
    }
}

fn is_temporary_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tmp"))
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with('.') || name.ends_with('~'))
}

fn desired_watch_roots(window_targets: &HashMap<String, HashSet<PathBuf>>) -> HashSet<PathBuf> {
    window_targets
        .values()
        .flat_map(|paths| paths.iter())
        .filter_map(|path| path.parent().map(Path::to_path_buf))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watch_roots_are_the_union_of_all_window_target_directories() {
        let mut targets: HashMap<String, HashSet<PathBuf>> = HashMap::new();
        targets.insert(
            "main".into(),
            HashSet::from([PathBuf::from("a/a.md"), PathBuf::from("a/shared.png")]),
        );
        targets.insert(
            "viewer-1".into(),
            HashSet::from([PathBuf::from("b/b.md"), PathBuf::from("a/shared.png")]),
        );
        assert_eq!(
            desired_watch_roots(&targets),
            HashSet::from([PathBuf::from("a"), PathBuf::from("b")])
        );
    }

    #[test]
    fn removing_one_window_preserves_other_window_targets() {
        let mut targets: HashMap<String, HashSet<PathBuf>> = HashMap::new();
        targets.insert("main".into(), HashSet::from([PathBuf::from("shared.md")]));
        targets.insert(
            "viewer-1".into(),
            HashSet::from([PathBuf::from("shared.md"), PathBuf::from("other.md")]),
        );
        targets.remove("main");
        assert_eq!(targets["viewer-1"].len(), 2);
    }

    #[test]
    fn atomic_replacement_is_detected_from_delete_then_create() {
        assert_eq!(
            merge_change_kind(FileChangeKind::Deleted, FileChangeKind::Created),
            FileChangeKind::Replaced
        );
    }

    #[test]
    fn temporary_rename_is_reported_as_replacement() {
        let event = Event {
            kind: EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            paths: vec![PathBuf::from("draft.tmp"), PathBuf::from("readme.md")],
            attrs: Default::default(),
        };
        assert_eq!(classify_event(&event), Some(FileChangeKind::Replaced));
    }

    #[test]
    fn destination_only_rename_is_reported_as_replacement() {
        let event = Event {
            kind: EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            paths: vec![PathBuf::from("readme.md")],
            attrs: Default::default(),
        };
        assert_eq!(classify_event(&event), Some(FileChangeKind::Replaced));
    }

    #[test]
    fn standalone_svg_mermaid_and_drawio_files_are_document_watch_targets() {
        for path in [
            "readme.md",
            "diagram.svg",
            "flow.mmd",
            "flow.mermaid",
            "system.drawio",
        ] {
            assert!(is_supported_document(Path::new(path)), "{path}");
        }
        assert!(!is_supported_document(Path::new("image.png")));
    }
}
