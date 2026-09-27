use crate::errors::{AppError, AppResult};
use crate::file_lock::{atomic_write, with_lock};
use std::path::Path;

pub fn save_html(path: &Path, html: &str, document_path: &str) -> AppResult<()> {
    if !path.is_absolute() || !matches!(path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("html" | "htm")) {
        return Err(AppError::PermissionDenied("HTMLの保存先を絶対パスで指定してください。".into()));
    }
    if html.is_empty() || html.len() > 128 * 1024 * 1024 || !html.trim_start().to_ascii_lowercase().starts_with("<!doctype html") {
        return Err(AppError::IoError("HTML出力の形式または容量が不正です。".into()));
    }
    if !path.parent().is_some_and(Path::is_dir) { return Err(AppError::IoError("保存先フォルダーがありません。".into())); }
    with_lock(path, || {
        if path.exists() && (path.is_dir() || std::fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(true)) {
            return Err(AppError::PermissionDenied("保存先が通常のファイルではありません。".into()));
        }
        if let (Ok(target), Ok(document)) = (path.canonicalize(), Path::new(document_path).canonicalize()) {
            if target == document { return Err(AppError::PermissionDenied("元文書を上書きできません。".into())); }
        }
        atomic_write(path, html.as_bytes())
    })
}

#[tauri::command]
pub fn save_html_export(path: String, html: String, document_path: String) -> Result<(), String> {
    save_html(Path::new(&path), &html, &document_path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bad_destination_and_preserves_existing_on_invalid_output() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("out.html");
        std::fs::write(&target, "old").unwrap();
        assert!(save_html(&target, "broken", "note.md").is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
        assert!(save_html(Path::new("out.html"), "<!doctype html><p>test</p>", "note.md").is_err());
        assert!(save_html(&root.path().join("out.md"), "<!doctype html><p>test</p>", "note.md").is_err());
        save_html(&target, "<!doctype html><p>日本語</p>", "note.md").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "<!doctype html><p>日本語</p>");
        assert!(save_html(&target, "<!doctype html><p>again</p>", target.to_str().unwrap()).is_err());
    }
}
