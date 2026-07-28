use crate::errors::{AppError, AppResult};
use fs4::FileExt;
use std::fs::{self, OpenOptions};
use std::path::Path;

pub fn with_lock<T>(path: &Path, work: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    let lock_path = path.with_extension("lock");
    let lock = OpenOptions::new().create(true).read(true).write(true).open(lock_path)
        .map_err(|e| AppError::IoError(format!("open lock: {e}")))?;
    FileExt::lock(&lock).map_err(|e| AppError::IoError(format!("acquire lock: {e}")))?;
    let result = work();
    FileExt::unlock(&lock).map_err(|e| AppError::IoError(format!("release lock: {e}")))?;
    drop(lock);
    result
}

pub fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
    let parent = path.parent().ok_or_else(|| AppError::IoError("missing parent directory".into()))?;
    fs::create_dir_all(parent).map_err(|e| AppError::IoError(format!("create parent: {e}")))?;
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, content).map_err(|e| AppError::IoError(format!("write temp: {e}")))?;
    OpenOptions::new().write(true).open(&temp).and_then(|f| f.sync_all()).map_err(|e| AppError::IoError(format!("sync temp: {e}")))?;
    // Windows cannot atomically replace an existing file with rename.
    fs::copy(&temp, path).map_err(|e| AppError::IoError(format!("replace target: {e}")))?;
    fs::remove_file(temp).map_err(|e| AppError::IoError(e.to_string()))
}
