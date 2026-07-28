use crate::backup::BackupManager;
use crate::watcher::FileWatcher;
use std::sync::Mutex;
pub struct AppState {
    pub initial_files: Vec<String>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub backup_mgr: BackupManager,
}

impl AppState {
    pub fn new(initial_files: Vec<String>) -> Result<Self, crate::errors::AppError> {
        Ok(Self {
            initial_files,
            watcher: Mutex::new(None),
            backup_mgr: BackupManager::new()?,
        })
    }
}
