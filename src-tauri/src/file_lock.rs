use crate::errors::{AppError, AppResult};
use fs4::FileExt;
use std::fs::{self, OpenOptions};
use std::path::Path;
use std::time::{Duration, Instant};

pub fn with_lock<T>(path: &Path, work: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    with_lock_timeout(path, Duration::from_secs(2), work)
}

/// Runs a short settings transaction while holding the file-specific lock.
///
/// The timeout is deliberately bounded: settings persistence must never leave a
/// window waiting indefinitely when another process is unhealthy.
pub fn with_lock_timeout<T>(
    path: &Path,
    timeout: Duration,
    work: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    ensure_parent_directory(path)?;
    let lock_path = path.with_extension("lock");
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|e| AppError::IoError(format!("open lock: {e}")))?;
    let deadline = Instant::now() + timeout;
    loop {
        match FileExt::try_lock(&lock) {
            Ok(()) => break,
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Err(error) => return Err(AppError::IoError(format!("acquire lock: {error}"))),
        }
    }
    let result = work();
    FileExt::unlock(&lock).map_err(|e| AppError::IoError(format!("release lock: {e}")))?;
    result
}

pub fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
    ensure_parent_directory(path)?;
    let temp = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::write(&temp, content).map_err(|e| AppError::IoError(format!("write temp: {e}")))?;
    OpenOptions::new()
        .write(true)
        .open(&temp)
        .and_then(|f| f.sync_all())
        .map_err(|e| AppError::IoError(format!("sync temp: {e}")))?;
    atomic_replace(&temp, path)
}

/// Atomically replaces `path` with a fully-written temporary file in the same
/// directory. Callers keep ownership of creating and syncing the temporary
/// file; this helper only performs the replacement and cleans up on failure.
pub fn atomic_replace(temp: &Path, path: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            let error = std::io::Error::last_os_error();
            let _ = fs::remove_file(&temp);
            return Err(AppError::IoError(format!("replace target: {error}")));
        }
    }
    #[cfg(not(target_os = "windows"))]
    fs::rename(&temp, path).map_err(|e| AppError::IoError(format!("replace target: {e}")))?;
    Ok(())
}

fn ensure_parent_directory(path: &Path) -> AppResult<()> {
    match path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        Some(parent) => {
            fs::create_dir_all(parent).map_err(|e| AppError::IoError(format!("create parent: {e}")))
        }
        None => Ok(()),
    }
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
        assert!(!fs::read_dir(dir.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }

    #[test]
    fn creates_missing_parent_before_opening_lock() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("first-launch").join("settings.json");
        with_lock(&path, || Ok(())).unwrap();
        assert!(path.parent().unwrap().join("settings.lock").exists());
    }

    #[test]
    fn lock_times_out_when_another_transaction_is_active() {
        use std::sync::{mpsc, Arc, Barrier};
        use std::thread;

        let dir = tempdir().unwrap();
        let path = Arc::new(dir.path().join("settings.json"));
        let barrier = Arc::new(Barrier::new(2));
        let (locked_tx, locked_rx) = mpsc::channel();
        let worker_path = Arc::clone(&path);
        let worker_barrier = Arc::clone(&barrier);
        let worker = thread::spawn(move || {
            with_lock(&worker_path, || {
                locked_tx.send(()).unwrap();
                worker_barrier.wait();
                std::thread::sleep(Duration::from_millis(100));
                Ok(())
            })
            .unwrap();
        });

        locked_rx.recv().unwrap();
        let result = with_lock_timeout(&path, Duration::from_millis(25), || Ok(()));
        barrier.wait();
        worker.join().unwrap();
        assert!(
            matches!(result, Err(AppError::IoError(message)) if message.starts_with("acquire lock:"))
        );
    }
}
