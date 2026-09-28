use crate::errors::{AppError, AppResult};
use crate::markdown::{content_revision, DocumentSourceKind};
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
    destination: PathBuf,
    markdown_source: String,
    overwrite: bool,
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
    pub path: Option<String>,
    pub revision: Option<String>,
    pub source: DocumentSourceKind,
    pub can_edit: bool,
    pub edit_disabled_reason: Option<String>,
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
        let session_dir = std::env::temp_dir().join("mdvisualizer").join(session);
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
        self.stage_at(document_path, preferred_filename, "document", None, bytes)
    }

    pub fn stage_relative(
        &self,
        document_path: &str,
        preferred_source: &str,
        bytes: &[u8],
    ) -> AppResult<StagedAssetResult> {
        if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
            return Err(AppError::IoError(
                "Asset data is empty or exceeds 50 MiB.".into(),
            ));
        }
        let normalized = preferred_source.trim().replace('\\', "/");
        let relative = Path::new(&normalized);
        if normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
            || relative.is_absolute()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(AppError::PermissionDenied(
                "Asset path must be a safe relative path.".into(),
            ));
        }
        let filename = relative
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        validate_filename(filename)?;
        let document = canonical_markdown(document_path)?;
        let parent = document
            .parent()
            .ok_or_else(|| AppError::IoError("Markdown parent folder is unavailable.".into()))?;
        let destination = parent.join(relative);
        let entries = self.entries.lock().unwrap();
        if entries
            .values()
            .any(|entry| entry.document == document && entry.destination == destination)
        {
            return Err(AppError::Conflict(format!(
                "Asset path is already staged: {normalized}"
            )));
        }
        drop(entries);
        self.write_staged_entry(document, destination, normalized, true, bytes)
    }

    pub fn stage_at(
        &self,
        document_path: &str,
        preferred_filename: &str,
        destination: &str,
        absolute_directory: Option<&str>,
        bytes: &[u8],
    ) -> AppResult<StagedAssetResult> {
        if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
            return Err(AppError::IoError(
                "Asset data is empty or exceeds 50 MiB.".into(),
            ));
        }
        let document = canonical_markdown(document_path)?;
        validate_filename(preferred_filename)?;
        let document_parent = document
            .parent()
            .ok_or_else(|| AppError::IoError("Markdown parent folder is unavailable.".into()))?;
        let (parent, relative_prefix) = match destination {
            "document" => (document_parent.to_path_buf(), None),
            "image" => (document_parent.join("image"), Some("image")),
            "fixed" => (document_parent.to_path_buf(), None),
            "absolute" => {
                let configured = absolute_directory.unwrap_or_default().trim();
                let directory = PathBuf::from(configured);
                if configured.is_empty() || !directory.is_absolute() {
                    return Err(AppError::PermissionDenied(
                        "Absolute image folder must be an absolute path.".into(),
                    ));
                }
                (directory, None)
            }
            _ => {
                return Err(AppError::PermissionDenied(
                    "Image destination setting is invalid.".into(),
                ))
            }
        };
        let entries = self.entries.lock().unwrap();
        let reserved = entries
            .values()
            .filter(|entry| entry.document == document)
            .filter_map(|entry| {
                entry
                    .destination
                    .parent()
                    .filter(|value| *value == parent)
                    .and_then(|_| entry.destination.file_name())
                    .map(|value| value.to_string_lossy().to_lowercase())
            })
            .collect::<HashSet<_>>();
        let overwrite = destination == "fixed";
        let filename = if overwrite {
            preferred_filename.to_string()
        } else {
            available_filename(&parent, preferred_filename, &reserved)?
        };
        let file_destination = parent.join(&filename);
        let markdown_source = if destination == "absolute" {
            file_destination.to_string_lossy().replace('\\', "/")
        } else if let Some(prefix) = relative_prefix {
            format!("{prefix}/{filename}")
        } else {
            filename.clone()
        };
        drop(entries);
        self.write_staged_entry(document, file_destination, markdown_source, overwrite, bytes)
    }

    fn write_staged_entry(
        &self,
        document: PathBuf,
        destination: PathBuf,
        markdown_source: String,
        overwrite: bool,
        bytes: &[u8],
    ) -> AppResult<StagedAssetResult> {
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
        self.entries.lock().unwrap().insert(
            id.clone(),
            StagedAsset {
                document,
                temp_path,
                destination,
                markdown_source: markdown_source.clone(),
                overwrite,
            },
        );
        Ok(StagedAssetResult {
            id,
            filename: markdown_source,
        })
    }

    pub fn update_text(&self, id: &str, text: &str) -> AppResult<()> {
        let bytes = text.as_bytes();
        if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
            return Err(AppError::IoError(
                "Asset data is empty or exceeds 50 MiB.".into(),
            ));
        }
        let entries = self.entries.lock().unwrap();
        let entry = entries
            .get(id)
            .ok_or_else(|| AppError::Conflict(format!("Staged asset is unavailable: {id}")))?;
        fs::write(&entry.temp_path, bytes)
            .map_err(|error| AppError::IoError(format!("update staged asset: {error}")))?;
        OpenOptions::new()
            .write(true)
            .open(&entry.temp_path)
            .and_then(|file| file.sync_all())
            .map_err(|error| AppError::IoError(format!("sync staged asset: {error}")))?;
        Ok(())
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
        let mut committed: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
        for entry in &staged {
            let destination = &entry.destination;
            let write_result = (|| {
                let parent = destination.parent().ok_or_else(|| {
                    AppError::IoError("Image destination folder is unavailable.".into())
                })?;
                fs::create_dir_all(parent)
                    .map_err(|error| AppError::IoError(format!("create image folder: {error}")))?;
                if entry.overwrite {
                    let document_parent = document.parent().ok_or_else(|| {
                        AppError::IoError("Markdown parent folder is unavailable.".into())
                    })?;
                    let resolved_parent = parent.canonicalize().map_err(|error| {
                        AppError::IoError(format!("canonicalize asset folder: {error}"))
                    })?;
                    if !resolved_parent.starts_with(document_parent) {
                        return Err(AppError::PermissionDenied(
                            "Asset path escaped the Markdown folder.".into(),
                        ));
                    }
                }
                let bytes = fs::read(&entry.temp_path)
                    .map_err(|error| AppError::IoError(format!("read staged asset: {error}")))?;
                let previous = if entry.overwrite && destination.exists() {
                    Some(fs::read(destination).map_err(|error| {
                        AppError::IoError(format!("backup existing asset: {error}"))
                    })?)
                } else {
                    None
                };
                let mut options = OpenOptions::new();
                options.write(true);
                if entry.overwrite {
                    options.create(true).truncate(true);
                } else {
                    options.create_new(true);
                }
                let mut output = options.open(destination).map_err(|error| {
                    AppError::Conflict(format!(
                        "Asset filename is no longer available ({}): {error}",
                        entry.markdown_source
                    ))
                })?;
                if let Err(error) = output.write_all(&bytes).and_then(|_| output.sync_all()) {
                    if let Some(bytes) = &previous {
                        let _ = fs::write(destination, bytes);
                    } else {
                        let _ = fs::remove_file(destination);
                    }
                    return Err(AppError::IoError(format!("commit staged asset: {error}")));
                }
                Ok::<Option<Vec<u8>>, AppError>(previous)
            })();
            match write_result {
                Ok(previous) => committed.push((destination.clone(), previous)),
                Err(error) => {
                    rollback_committed_assets(&committed);
                    return Err(error);
                }
            }
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
                rollback_committed_assets(&committed);
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
    let (media_type, is_text) = media_type_for(&path)?;
    let bytes =
        fs::read(&path).map_err(|error| AppError::IoError(format!("read asset: {error}")))?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(AppError::IoError("Asset exceeds 50 MiB.".into()));
    }
    let text = is_text
        .then(|| {
            String::from_utf8(bytes.clone())
                .map_err(|_| AppError::IoError("Text asset must be UTF-8.".into()))
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
        path: Some(path.to_string_lossy().into_owned()),
        revision: Some(content_revision(&bytes)),
        source: DocumentSourceKind::Local,
        can_edit: true,
        edit_disabled_reason: None,
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
        "drawio" => Ok(("application/vnd.jgraph.mxfile", true)),
        "mmd" | "mermaid" => Ok(("text/vnd.mermaid", true)),
        "csv" => Ok(("text/csv", true)),
        "tsv" => Ok(("text/tab-separated-values", true)),
        "txt" | "md" | "json" | "xml" | "html" | "css" | "js" | "jsx" | "ts" | "tsx" | "py"
        | "rs" | "cs" | "java" | "c" | "h" | "cpp" | "hpp" | "sql" | "yaml" | "yml" | "toml"
        | "ini" | "log" | "sh" | "ps1" | "vb" => Ok(("text/plain", true)),
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
    let numeric_start = stem
        .char_indices()
        .rev()
        .find(|(_, value)| !value.is_ascii_digit())
        .map(|(index, value)| index + value.len_utf8())
        .unwrap_or(0);
    if numeric_start < stem.len() && stem[..numeric_start].eq_ignore_ascii_case("image") {
        let prefix = &stem[..numeric_start];
        let first = stem[numeric_start..].parse::<u32>().unwrap_or(1).max(1);
        for number in first..=10_000 {
            let candidate = format!("{prefix}{number}.{extension}");
            if !parent.join(&candidate).exists() && !reserved.contains(&candidate.to_lowercase()) {
                return Ok(candidate);
            }
        }
        return Err(AppError::Conflict(
            "Could not allocate an unused asset filename.".into(),
        ));
    }
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
    fn allocates_unicode_caption_filenames_without_splitting_characters() {
        let dir = tempdir().unwrap();
        let reserved = HashSet::new();
        for name in ["外部画像.png", "図1.png", "図😀.png", "図😀12.png"] {
            assert_eq!(
                available_filename(dir.path(), name, &reserved).unwrap(),
                name
            );
            fs::write(dir.path().join(name), b"existing").unwrap();
            let path = Path::new(name);
            let expected = format!("{}-2.png", path.file_stem().unwrap().to_str().unwrap());
            assert_eq!(
                available_filename(dir.path(), name, &reserved).unwrap(),
                expected
            );
        }
        fs::write(dir.path().join("image1.png"), b"existing").unwrap();
        assert_eq!(
            available_filename(dir.path(), "image1.png", &reserved).unwrap(),
            "image2.png"
        );
    }

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
        fs::write(dir.path().join("diagram.drawio"), "<mxGraphModel/>").unwrap();
        fs::write(dir.path().join("table.csv"), "a,b\n1,2").unwrap();
        let loaded = read_document_asset(&document.to_string_lossy(), "shape.svg").unwrap();
        assert_eq!(loaded.text.as_deref(), Some("<svg/>"));
        let drawio = read_document_asset(&document.to_string_lossy(), "diagram.drawio").unwrap();
        assert_eq!(drawio.media_type, "application/vnd.jgraph.mxfile");
        assert_eq!(drawio.text.as_deref(), Some("<mxGraphModel/>"));
        let table = read_document_asset(&document.to_string_lossy(), "table.csv").unwrap();
        assert_eq!(table.media_type, "text/csv");
        assert_eq!(table.text.as_deref(), Some("a,b\n1,2"));
        assert!(read_document_asset(&document.to_string_lossy(), "../outside.png").is_err());
    }

    #[test]
    fn deletes_asset_only_when_revision_matches() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        let asset = dir.path().join("diagram.mmd");
        fs::write(&document, "# note").unwrap();
        fs::write(&asset, "graph TD\nA-->B").unwrap();
        let loaded = read_document_asset(document.to_str().unwrap(), "diagram.mmd").unwrap();
        assert!(
            delete_document_asset(document.to_str().unwrap(), "diagram.mmd", Some("wrong"))
                .is_err()
        );
        delete_document_asset(
            document.to_str().unwrap(),
            "diagram.mmd",
            loaded.revision.as_deref(),
        )
        .unwrap();
        assert!(!asset.exists());
    }

    #[test]
    fn stages_drawio_text_and_commits_it_with_markdown() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "old").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage(
                &document.to_string_lossy(),
                "diagram.drawio",
                b"<mxGraphModel/>",
            )
            .unwrap();
        assert_eq!(staged.filename, "diagram.drawio");
        assert!(!dir.path().join("diagram.drawio").exists());
        manager
            .commit_with(&document, &[staged.id], || Ok(()))
            .unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("diagram.drawio")).unwrap(),
            "<mxGraphModel/>"
        );
    }

    #[test]
    fn stages_mermaid_text_and_commits_it_with_markdown() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "old").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage(
                &document.to_string_lossy(),
                "flow.mmd",
                b"flowchart LR\nA --> B",
            )
            .unwrap();
        assert_eq!(staged.filename, "flow.mmd");
        manager
            .commit_with(&document, &[staged.id], || Ok(()))
            .unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("flow.mmd")).unwrap(),
            "flowchart LR\nA --> B"
        );
    }

    #[test]
    fn stages_relative_path_and_overwrites_existing_asset() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        let asset = dir.path().join("src").join("main.rs");
        fs::create_dir_all(asset.parent().unwrap()).unwrap();
        fs::write(&document, "old markdown").unwrap();
        fs::write(&asset, "old code").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage_relative(&document.to_string_lossy(), "src/main.rs", b"new code")
            .unwrap();
        assert_eq!(staged.filename, "src/main.rs");
        manager
            .commit_with(&document, &[staged.id], || {
                fs::write(&document, "new markdown").unwrap();
                Ok(())
            })
            .unwrap();
        assert_eq!(fs::read_to_string(asset).unwrap(), "new code");
    }

    #[test]
    fn updates_staged_text_before_commit() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        let asset = dir.path().join("table.tsv");
        fs::write(&document, "![TSV](table.tsv)").unwrap();
        fs::write(&asset, "a\nold").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage_relative(&document.to_string_lossy(), "table.tsv", b"a\nfirst")
            .unwrap();

        manager.update_text(&staged.id, "a\nsecond").unwrap();
        manager
            .commit_with(&document, &[staged.id], || Ok(()))
            .unwrap();

        assert_eq!(fs::read_to_string(asset).unwrap(), "a\nsecond");
    }

    #[test]
    fn restores_overwritten_relative_asset_when_markdown_save_fails() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        let asset = dir.path().join("src").join("main.rs");
        fs::create_dir_all(asset.parent().unwrap()).unwrap();
        fs::write(&document, "old markdown").unwrap();
        fs::write(&asset, "old code").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage_relative(&document.to_string_lossy(), "src/main.rs", b"new code")
            .unwrap();
        let result = manager.commit_with(&document, &[staged.id], || {
            Err::<(), _>(AppError::Conflict("stale".into()))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(asset).unwrap(), "old code");
    }

    #[test]
    fn rejects_unsafe_relative_asset_paths() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "old markdown").unwrap();
        let manager = AssetStagingManager::new().unwrap();

        for source in ["../main.rs", "src/../main.rs", "/main.rs", "src//main.rs"] {
            assert!(
                manager
                    .stage_relative(&document.to_string_lossy(), source, b"code")
                    .is_err(),
                "{source}"
            );
        }
    }

    #[test]
    fn stages_image_subfolder_and_absolute_folder_references() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        let absolute = dir.path().join("Shared Images");
        fs::write(&document, "old").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let relative = manager
            .stage_at(
                &document.to_string_lossy(),
                "20260824_090507.png",
                "image",
                None,
                b"relative",
            )
            .unwrap();
        let external = manager
            .stage_at(
                &document.to_string_lossy(),
                "20260824_090507.png",
                "absolute",
                Some(&absolute.to_string_lossy()),
                b"absolute",
            )
            .unwrap();
        assert_eq!(relative.filename, "image/20260824_090507.png");
        assert!(external
            .filename
            .replace('\\', "/")
            .ends_with("/Shared Images/20260824_090507.png"));
        manager
            .commit_with(&document, &[relative.id, external.id], || Ok(()))
            .unwrap();
        assert_eq!(
            fs::read(dir.path().join("image/20260824_090507.png")).unwrap(),
            b"relative"
        );
        assert_eq!(
            fs::read(absolute.join("20260824_090507.png")).unwrap(),
            b"absolute"
        );
    }

    #[test]
    fn fixed_image_destination_overwrites_the_same_relative_file() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "old").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let first = manager.stage_at(&document.to_string_lossy(), "test.png", "fixed", None, b"first").unwrap();
        manager.commit_with(&document, &[first.id], || Ok(())).unwrap();
        let second = manager.stage_at(&document.to_string_lossy(), "test.png", "fixed", None, b"second").unwrap();
        manager.commit_with(&document, &[second.id], || Ok(())).unwrap();
        assert_eq!(first.filename, "test.png");
        assert_eq!(second.filename, "test.png");
        assert_eq!(fs::read(dir.path().join("test.png")).unwrap(), b"second");
    }

    #[test]
    fn numbered_image_destination_uses_the_lowest_unused_image_number() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        let image_folder = dir.path().join("image");
        fs::create_dir_all(&image_folder).unwrap();
        fs::write(&document, "old").unwrap();
        fs::write(image_folder.join("image1.png"), b"existing").unwrap();
        fs::write(image_folder.join("image3.png"), b"existing").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let staged = manager
            .stage_at(
                &document.to_string_lossy(),
                "image1.png",
                "image",
                None,
                b"new",
            )
            .unwrap();
        assert_eq!(staged.filename, "image/image2.png");
    }

    #[test]
    fn rejects_a_non_absolute_configured_folder() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "old").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        assert!(manager
            .stage_at(
                &document.to_string_lossy(),
                "image.png",
                "absolute",
                Some("relative"),
                b"image"
            )
            .is_err());
    }

    #[test]
    fn rolls_back_prior_assets_when_a_later_destination_folder_fails() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("note.md");
        let blocked_folder = dir.path().join("blocked");
        fs::write(&document, "old").unwrap();
        fs::write(&blocked_folder, "not a folder").unwrap();
        let manager = AssetStagingManager::new().unwrap();
        let first = manager
            .stage_at(
                &document.to_string_lossy(),
                "first.png",
                "image",
                None,
                b"first",
            )
            .unwrap();
        let second = manager
            .stage_at(
                &document.to_string_lossy(),
                "second.png",
                "absolute",
                Some(&blocked_folder.to_string_lossy()),
                b"second",
            )
            .unwrap();

        assert!(manager
            .commit_with(&document, &[first.id, second.id], || Ok(()))
            .is_err());
        assert!(!dir.path().join("image/first.png").exists());
    }
}

pub fn delete_document_asset(
    document_path: &str,
    source: &str,
    expected_revision: Option<&str>,
) -> AppResult<()> {
    let asset = read_document_asset(document_path, source)?;
    if let (Some(expected), Some(actual)) = (expected_revision, asset.revision.as_deref()) {
        if expected != actual {
            return Err(AppError::Conflict("Asset changed before deletion.".into()));
        }
    }
    let path = asset
        .path
        .ok_or_else(|| AppError::FileNotFound(source.into()))?;
    fs::remove_file(&path).map_err(|error| AppError::IoError(format!("delete asset: {error}")))
}

fn rollback_committed_assets(committed: &[(PathBuf, Option<Vec<u8>>)]) {
    for (path, previous) in committed.iter().rev() {
        if let Some(bytes) = previous {
            let _ = fs::write(path, bytes);
        } else {
            let _ = fs::remove_file(path);
        }
    }
}
