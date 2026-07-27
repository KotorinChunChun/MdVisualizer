use crate::backup::BackupManager;
use crate::watcher::FileWatcher;
use std::sync::Mutex;

pub struct AppState {
    pub initial_file: Mutex<Option<String>>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub backup_mgr: BackupManager,
}

impl AppState {
    pub fn new(initial_file: Option<String>) -> Result<Self, crate::errors::AppError> {
        Ok(Self {
            initial_file: Mutex::new(initial_file),
            watcher: Mutex::new(None),
            backup_mgr: BackupManager::new()?,
        })
    }
}
