use crate::backup::BackupManager;
use crate::watcher::FileWatcher;
use std::sync::Mutex;
use std::collections::HashMap;
pub struct AppState {
    pub initial_files: Mutex<HashMap<String, Vec<String>>>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub backup_mgr: BackupManager,
}

impl AppState {
    pub fn new(initial_files: Vec<String>) -> Result<Self, crate::errors::AppError> {
        Ok(Self {
            initial_files: Mutex::new(HashMap::from([("main".to_string(), initial_files)])),
            watcher: Mutex::new(None),
            backup_mgr: BackupManager::new()?,
        })
    }
}
