use crate::errors::{AppError, AppResult};
use fs4::FileExt;
use std::fs::{self, OpenOptions};
use std::path::Path;
use std::time::{Duration, Instant};

pub fn with_lock<T>(path: &Path, work: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    let lock_path = path.with_extension("lock");
    let lock = OpenOptions::new().create(true).read(true).write(true).open(lock_path)
        .map_err(|e| AppError::IoError(format!("open lock: {e}")))?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match FileExt::try_lock(&lock) {
            Ok(()) => break,
            Err(error) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Err(error) => return Err(AppError::IoError(format!("acquire lock: {error}"))),
        }
    }
    let result = work();
    FileExt::unlock(&lock).map_err(|e| AppError::IoError(format!("release lock: {e}")))?;
    result
}

pub fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
    let parent = path.parent().ok_or_else(|| AppError::IoError("missing parent directory".into()))?;
    fs::create_dir_all(parent).map_err(|e| AppError::IoError(format!("create parent: {e}")))?;
    let temp = path.with_extension(format!("{}.{}.tmp", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
    fs::write(&temp, content).map_err(|e| AppError::IoError(format!("write temp: {e}")))?;
    OpenOptions::new().write(true).open(&temp).and_then(|f| f.sync_all()).map_err(|e| AppError::IoError(format!("sync temp: {e}")))?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
        let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) } == 0 {
            let error = std::io::Error::last_os_error();
            let _ = fs::remove_file(&temp);
            return Err(AppError::IoError(format!("replace target: {error}")));
        }
    }
    #[cfg(not(target_os = "windows"))]
    fs::rename(&temp, path).map_err(|e| AppError::IoError(format!("replace target: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn atomically_replaces_existing_content_without_temp_residue() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert!(!fs::read_dir(dir.path()).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
    }
}
