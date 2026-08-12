use crate::errors::{AppError, AppResult};
use base64::Engine;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;

#[derive(Clone)]
struct StagedAsset {
    document: PathBuf,
    temp_path: PathBuf,
    filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAssetResult {
    pub id: String,
    pub filename: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentAssetData {
    pub filename: String,
    pub media_type: String,
    pub base64: String,
    pub text: Option<String>,
}

pub struct AssetStagingManager {
    session_dir: PathBuf,
    sequence: AtomicU64,
    entries: Mutex<HashMap<String, StagedAsset>>,
}

impl AssetStagingManager {
    pub fn new() -> AppResult<Self> {
        let session = format!(
            "assets-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let session_dir = std::env::temp_dir().join("markdown-viewer").join(session);
        fs::create_dir_all(&session_dir)
            .map_err(|error| AppError::IoError(format!("create asset staging: {error}")))?;
        Ok(Self {
            session_dir,
            sequence: AtomicU64::new(1),
            entries: Mutex::new(HashMap::new()),
        })
    }

    pub fn stage(
        &self,
        document_path: &str,
        preferred_filename: &str,
        bytes: &[u8],
    ) -> AppResult<StagedAssetResult> {
        if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
            return Err(AppError::IoError(
                "Asset data is empty or exceeds 50 MiB.".into(),
            ));
        }
        let document = canonical_markdown(document_path)?;
        validate_filename(preferred_filename)?;
        let parent = document
            .parent()
            .ok_or_else(|| AppError::IoError("Markdown parent folder is unavailable.".into()))?;
        let mut entries = self.entries.lock().unwrap();
        let reserved = entries
            .values()
            .filter(|entry| entry.document == document)
            .map(|entry| entry.filename.to_lowercase())
            .collect::<HashSet<_>>();
        let filename = available_filename(parent, preferred_filename, &reserved)?;
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let id = format!("{}-{sequence}", std::process::id());
        let temp_path = self.session_dir.join(format!("{id}.stage"));
        fs::write(&temp_path, bytes)
            .map_err(|error| AppError::IoError(format!("write staged asset: {error}")))?;
        OpenOptions::new()
            .write(true)
            .open(&temp_path)
            .and_then(|file| file.sync_all())
            .map_err(|error| AppError::IoError(format!("sync staged asset: {error}")))?;
        entries.insert(
            id.clone(),
            StagedAsset {
                document,
                temp_path,
                filename: filename.clone(),
            },
        );
        Ok(StagedAssetResult { id, filename })
    }

    pub fn discard(&self, ids: &[String]) {
        let mut entries = self.entries.lock().unwrap();
        for id in ids {
            if let Some(entry) = entries.remove(id) {
                let _ = fs::remove_file(entry.temp_path);
            }
        }
    }

    pub fn commit_with<T>(
        &self,
        document_path: &Path,
        ids: &[String],
        save: impl FnOnce() -> AppResult<T>,
    ) -> AppResult<T> {
        if ids.is_empty() {
            return save();
        }
        let document = document_path
            .canonicalize()
            .map_err(|error| AppError::IoError(format!("canonicalize Markdown: {error}")))?;
        let mut entries = self.entries.lock().unwrap();
        let staged =
            ids.iter()
                .map(|id| {
                    entries.get(id).cloned().ok_or_else(|| {
                        AppError::Conflict(format!("Staged asset is unavailable: {id}"))
                    })
                })
                .collect::<AppResult<Vec<_>>>()?;
        if staged.iter().any(|entry| entry.document != document) {
            return Err(AppError::PermissionDenied(
                "Staged asset belongs to another Markdown document.".into(),
            ));
        }
        let parent = document
            .parent()
            .ok_or_else(|| AppError::IoError("Markdown parent folder is unavailable.".into()))?;
        let mut created = Vec::new();
        for entry in &staged {
            let destination = parent.join(&entry.filename);
            let bytes = fs::read(&entry.temp_path)
                .map_err(|error| AppError::IoError(format!("read staged asset: {error}")))?;
            let mut output = match OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&destination)
            {
                Ok(output) => output,
                Err(error) => {
                    for path in &created {
                        let _ = fs::remove_file(path);
                    }
                    return Err(AppError::Conflict(format!(
                        "Asset filename is no longer available ({}): {error}",
                        entry.filename
                    )));
                }
            };
            if let Err(error) = output.write_all(&bytes).and_then(|_| output.sync_all()) {
                let _ = fs::remove_file(&destination);
                for path in &created {
                    let _ = fs::remove_file(path);
                }
                return Err(AppError::IoError(format!("commit staged asset: {error}")));
            }
            created.push(destination);
        }
        match save() {
            Ok(result) => {
                for id in ids {
                    if let Some(entry) = entries.remove(id) {
                        let _ = fs::remove_file(entry.temp_path);
                    }
                }
                Ok(result)
            }
            Err(error) => {
                for path in created {
                    let _ = fs::remove_file(path);
                }
                Err(error)
            }
        }
    }
}

impl Drop for AssetStagingManager {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.session_dir);
    }
}

pub fn read_document_asset(document_path: &str, source: &str) -> AppResult<DocumentAssetData> {
    let document = canonical_markdown(document_path)?;
    if source.contains("://") || source.to_ascii_lowercase().starts_with("data:") {
        return Err(AppError::PermissionDenied(
            "Only local document assets can be read.".into(),
        ));
    }
    let relative = Path::new(source.split(['?', '#']).next().unwrap_or(source));
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(AppError::PermissionDenied(
            "Asset path must stay inside the Markdown folder.".into(),
        ));
    }
    let parent = document.parent().unwrap();
    let path = parent
        .join(relative)
        .canonicalize()
        .map_err(|_| AppError::FileNotFound(source.into()))?;
    if !path.starts_with(parent) {
        return Err(AppError::PermissionDenied(
            "Asset path escaped the Markdown folder.".into(),
        ));
    }
    let (media_type, is_svg) = media_type_for(&path)?;
    let bytes =
        fs::read(&path).map_err(|error| AppError::IoError(format!("read asset: {error}")))?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(AppError::IoError("Asset exceeds 50 MiB.".into()));
    }
    let text = is_svg
        .then(|| {
            String::from_utf8(bytes.clone())
                .map_err(|_| AppError::IoError("SVG must be UTF-8 text.".into()))
        })
        .transpose()?;
    Ok(DocumentAssetData {
        filename: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        media_type: media_type.into(),
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        text,
    })
}

fn canonical_markdown(path: &str) -> AppResult<PathBuf> {
    let requested = PathBuf::from(path);
    if !matches!(
        requested
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    ) {
        return Err(AppError::UnsupportedDocument(path.into()));
    }
    requested
        .canonicalize()
        .map_err(|_| AppError::FileNotFound(path.into()))
}

fn validate_filename(filename: &str) -> AppResult<()> {
    let path = Path::new(filename);
    if filename.trim().is_empty()
        || path.file_name().and_then(|value| value.to_str()) != Some(filename)
        || filename
            .chars()
            .any(|value| matches!(value, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err(AppError::PermissionDenied(
            "Asset filename is invalid.".into(),
        ));
    }
    media_type_for(path).map(|_| ())
}

fn media_type_for(path: &Path) -> AppResult<(&'static str, bool)> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Ok(("image/png", false)),
        "jpg" | "jpeg" => Ok(("image/jpeg", false)),
        "gif" => Ok(("image/gif", false)),
        "webp" => Ok(("image/webp", false)),
        "bmp" => Ok(("image/bmp", false)),
        "svg" => Ok(("image/svg+xml", true)),
        _ => Err(AppError::UnsupportedDocument(
            path.to_string_lossy().into_owned(),
        )),
    }
}

fn available_filename(
    parent: &Path,
    preferred: &str,
    reserved: &HashSet<String>,
) -> AppResult<String> {
    let path = Path::new(preferred);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("asset");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    for number in 1..=10_000 {
        let candidate = if number == 1 {
            preferred.to_string()
        } else {
            format!("{stem}-{number}.{extension}")
        };
        if !parent.join(&candidate).exists() && !reserved.contains(&candidate.to_lowercase()) {
            return Ok(candidate);
        }
    }
    Err(AppError::Conflict(
        "Could not allocate an unused asset filename.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn stages_with_a_collision_free_name_and_commits_only_with_markdown_save() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "old").unwrap();
        fs::write(dir.path().join("image.png"), b"existing").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage(&document.to_string_lossy(), "image.png", b"new-image")
            .unwrap();
        assert_eq!(staged.filename, "image-2.png");
        assert!(!dir.path().join("image-2.png").exists());
        manager
            .commit_with(&document, &[staged.id], || {
                fs::write(&document, "saved").unwrap();
                Ok(())
            })
            .unwrap();
        assert_eq!(
            fs::read(dir.path().join("image-2.png")).unwrap(),
            b"new-image"
        );
    }

    #[test]
    fn removes_committed_assets_when_markdown_save_fails() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "old").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage(&document.to_string_lossy(), "diagram.svg", b"<svg/>")
            .unwrap();
        let result = manager.commit_with(&document, &[staged.id], || {
            Err::<(), _>(AppError::Conflict("stale".into()))
        });
        assert!(result.is_err());
        assert!(!dir.path().join("diagram.svg").exists());
    }

    #[test]
    fn reads_only_supported_assets_below_the_markdown_folder() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "# note").unwrap();
        fs::write(dir.path().join("shape.svg"), "<svg/>").unwrap();
        let loaded = read_document_asset(&document.to_string_lossy(), "shape.svg").unwrap();
        assert_eq!(loaded.text.as_deref(), Some("<svg/>"));
        assert!(read_document_asset(&document.to_string_lossy(), "../outside.png").is_err());
    }
}
