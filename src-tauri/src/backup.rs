use crate::errors::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct BackupManager {
    session_dir: PathBuf,
    backups: Mutex<HashMap<PathBuf, PathBuf>>,
}

impl BackupManager {
    pub fn new() -> AppResult<Self> {
        let session_id = format!("{:x}", rand_simple_hash());
        let temp_base = std::env::temp_dir().join("markdown-viewer").join(session_id);
        fs::create_dir_all(&temp_base).map_err(|e| AppError::BackupError(e.to_string()))?;

        Ok(Self {
            session_dir: temp_base,
            backups: Mutex::new(HashMap::new()),
        })
    }

    /// クロップ確定直前に、元画像のバックアップを未作成なら安全に作成する
    pub fn ensure_backup(&self, original_path: &Path) -> AppResult<PathBuf> {
        let mut map = self.backups.lock().unwrap();

        let canonical_original = original_path
            .canonicalize()
            .unwrap_or_else(|_| original_path.to_path_buf());

        if let Some(existing_backup) = map.get(&canonical_original) {
            if existing_backup.exists() {
                return Ok(existing_backup.clone());
            }
        }

        if !canonical_original.exists() {
            return Err(AppError::FileNotFound(
                canonical_original.to_string_lossy().into_owned(),
            ));
        }

        // パスハッシュからバックアップファイル名を生成
        let hash = hash_path(&canonical_original);
        let ext = canonical_original
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("tmp");

        let backup_filename = format!("{}.{}", hash, ext);
        let backup_path = self.session_dir.join(backup_filename);

        fs::copy(&canonical_original, &backup_path)
            .map_err(|e| AppError::BackupError(format!("Failed to copy to backup: {}", e)))?;

        map.insert(canonical_original, backup_path.clone());
        Ok(backup_path)
    }

    /// 一時バックアップから元画像を復元する
    pub fn restore(&self, original_path: &Path) -> AppResult<bool> {
        let map = self.backups.lock().unwrap();
        let canonical_original = original_path
            .canonicalize()
            .unwrap_or_else(|_| original_path.to_path_buf());

        if let Some(backup_path) = map.get(&canonical_original) {
            if backup_path.exists() {
                fs::copy(backup_path, &canonical_original).map_err(|e| {
                    AppError::BackupError(format!("Failed to restore from backup: {}", e))
                })?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn has_backup(&self, original_path: &Path) -> bool {
        let map = self.backups.lock().unwrap();
        let canonical_original = original_path
            .canonicalize()
            .unwrap_or_else(|_| original_path.to_path_buf());
        map.get(&canonical_original)
            .map_or(false, |p| p.exists())
    }
}

impl Drop for BackupManager {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.session_dir);
    }
}

fn hash_path(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

fn rand_simple_hash() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(123456)
}
