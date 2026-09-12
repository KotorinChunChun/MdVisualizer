use crate::errors::{AppError, AppResult};
use fs4::FileExt;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const APP_IDENTIFIER: &str = "com.mdvisualizer.viewer";
const LOCK_DIRECTORY_NAME: &str = "locks";

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
    let lock_path = lock_path(path)?;
    ensure_parent_directory(&lock_path)?;
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

fn lock_path(path: &Path) -> AppResult<PathBuf> {
    let lock_directory = lock_directory(path)?;
    let normalized = normalized_target_path(path)?;
    let identity = normalized.to_string_lossy().replace('\\', "/");
    #[cfg(target_os = "windows")]
    let identity = identity.to_lowercase();
    let digest = Sha256::digest(identity.as_bytes());
    let filename = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(lock_directory.join(format!("{filename}.lock")))
}

fn normalized_target_path(path: &Path) -> AppResult<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| AppError::IoError(format!("resolve lock target: {error}")))?
            .join(path)
    };
    if let Ok(canonical) = fs::canonicalize(&absolute) {
        return Ok(canonical);
    }
    match (absolute.parent(), absolute.file_name()) {
        (Some(parent), Some(filename)) => Ok(fs::canonicalize(parent)
            .unwrap_or_else(|_| parent.to_path_buf())
            .join(filename)),
        _ => Ok(absolute),
    }
}

fn application_lock_directory(base: &Path) -> PathBuf {
    base.join(APP_IDENTIFIER).join(LOCK_DIRECTORY_NAME)
}

#[cfg(not(test))]
fn lock_directory(_target: &Path) -> AppResult<PathBuf> {
    dirs::data_dir()
        .map(|base| application_lock_directory(&base))
        .ok_or_else(|| AppError::IoError("resolve application data directory".into()))
}

#[cfg(test)]
fn lock_directory(target: &Path) -> AppResult<PathBuf> {
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| AppError::IoError("resolve test lock directory".into()))?;
    Ok(parent.join(".mdvisualizer-test-locks"))
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
    fn creates_missing_parent_without_adjacent_lock_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("first-launch").join("settings.json");
        with_lock(&path, || Ok(())).unwrap();
        assert!(path.parent().unwrap().exists());
        assert!(!path.parent().unwrap().join("settings.lock").exists());
        assert!(lock_path(&path).unwrap().exists());
    }

    #[test]
    fn application_lock_directory_is_scoped_to_the_app_identifier() {
        let base = Path::new("application-data");
        assert_eq!(
            application_lock_directory(base),
            base.join("com.mdvisualizer.viewer").join("locks")
        );
    }

    #[test]
    fn different_extensions_get_different_lock_files() {
        let dir = tempdir().unwrap();
        let markdown = dir.path().join("document.md");
        let image = dir.path().join("document.png");
        assert_ne!(lock_path(&markdown).unwrap(), lock_path(&image).unwrap());
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
