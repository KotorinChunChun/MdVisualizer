use crate::asset_staging::AssetStagingManager;
use crate::backup::BackupManager;
use crate::sharepoint::SharePointClient;
use crate::watcher::FileWatcher;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DebugTabState {
    pub id: String,
    pub path: String,
    pub kind: String,
    pub active: bool,
    pub dirty: bool,
    pub loading: bool,
    pub error: Option<String>,
    pub editor_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DebugWindowState {
    pub label: String,
    pub active_tab_id: Option<String>,
    pub media_preview_open: bool,
    pub tabs: Vec<DebugTabState>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DebugApplicationState {
    pub process_id: u32,
    pub generated_at: String,
    pub windows: Vec<DebugWindowState>,
}

pub struct AppState {
    pub received_uri: crate::received_uri::ReceivedUriStore,
    pub initial_files: Mutex<HashMap<String, Vec<String>>>,
    pub window_geometries: Mutex<HashMap<String, WindowGeometry>>,
    pub debug_windows: Mutex<HashMap<String, DebugWindowState>>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub window_sequence: AtomicU64,
    pub backup_mgr: BackupManager,
    pub asset_staging: AssetStagingManager,
    pub sharepoint: SharePointClient,
}

impl AppState {
    pub fn new(initial_files: Vec<String>) -> Result<Self, crate::errors::AppError> {
        Ok(Self {
            received_uri: Default::default(),
            initial_files: Mutex::new(HashMap::from([("main".to_string(), initial_files)])),
            window_geometries: Mutex::new(HashMap::new()),
            debug_windows: Mutex::new(HashMap::new()),
            watcher: Mutex::new(None),
            window_sequence: AtomicU64::new(1),
            backup_mgr: BackupManager::new()?,
            asset_staging: AssetStagingManager::new()?,
            sharepoint: SharePointClient::new()
                .map_err(|error| crate::errors::AppError::Unknown(error.to_string()))?,
        })
    }
}
