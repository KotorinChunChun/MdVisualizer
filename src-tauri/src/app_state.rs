use crate::asset_staging::AssetStagingManager;
use crate::backup::BackupManager;
use crate::watcher::FileWatcher;
use crate::sharepoint::SharePointClient;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
pub struct AppState {
    pub initial_files: Mutex<HashMap<String, Vec<String>>>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub window_sequence: AtomicU64,
    pub backup_mgr: BackupManager,
    pub asset_staging: AssetStagingManager,
    pub sharepoint: SharePointClient,
}

impl AppState {
    pub fn new(initial_files: Vec<String>) -> Result<Self, crate::errors::AppError> {
        Ok(Self {
            initial_files: Mutex::new(HashMap::from([("main".to_string(), initial_files)])),
            watcher: Mutex::new(None),
            window_sequence: AtomicU64::new(1),
            backup_mgr: BackupManager::new()?,
            asset_staging: AssetStagingManager::new()?,
            sharepoint: SharePointClient::new()
                .map_err(|error| crate::errors::AppError::Unknown(error.to_string()))?,
        })
    }
}
