use crate::errors::{AppError, AppResult};
use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone)]
pub struct MarkdownLoadResult {
    pub path: String,
    pub content: String,
    pub base_dir: String,
    pub image_paths: Vec<String>,
}

pub fn load_markdown(path_str: &str) -> AppResult<MarkdownLoadResult> {
    let path = PathBuf::from(path_str);
    if !path.exists() {
        return Err(AppError::FileNotFound(path_str.to_string()));
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::IoError(format!("Failed to read markdown file: {}", e)))?;

    let canonical_path = path.canonicalize().unwrap_or(path);
    let base_dir = canonical_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let base_path = Path::new(&base_dir);
    let image_paths = extract_image_paths(&content, base_path);

    Ok(MarkdownLoadResult {
        path: canonical_path.to_string_lossy().to_string(),
        content,
        base_dir,
        image_paths,
    })
}

/// Markdown本文中の画像参照 (`![alt](path)` および `<img src="path">`) からローカル絶対パスを抽出
pub fn extract_image_paths(content: &str, base_dir: &Path) -> Vec<String> {
    let mut results = Vec::new();

    // 1. Markdown標準画像記法 ![...](path)
    let md_img_re = Regex::new(r"!\[.*?\]\((.+?)(?:\s+.*?)?\)").unwrap();
    for cap in md_img_re.captures_iter(content) {
        if let Some(src) = cap.get(1) {
            let src_str = src.as_str().trim();
            if is_local_image_path(src_str) {
                if let Some(resolved) = resolve_image_path(src_str, base_dir) {
                    results.push(resolved);
                }
            }
        }
    }

    // 2. HTML <img> 記法
    let html_img_re = Regex::new(r#"(?i)<img\s+[^>]*src=["']([^"']+)["'][^>]*>"#).unwrap();
    for cap in html_img_re.captures_iter(content) {
        if let Some(src) = cap.get(1) {
            let src_str = src.as_str().trim();
            if is_local_image_path(src_str) {
                if let Some(resolved) = resolve_image_path(src_str, base_dir) {
                    results.push(resolved);
                }
            }
        }
    }

    results.sort();
    results.dedup();
    results
}

fn is_local_image_path(src: &str) -> bool {
    let lower = src.to_lowercase();
    !lower.starts_with("http://")
        && !lower.starts_with("https://")
        && !lower.starts_with("data:")
}

fn resolve_image_path(src: &str, base_dir: &Path) -> Option<String> {
    let p = Path::new(src);
    let full_path = if p.is_absolute() {
        p.to_path_buf()
    } else {
        base_dir.join(p)
    };

    if full_path.exists() {
        let canonical = full_path.canonicalize().unwrap_or(full_path);
        Some(canonical.to_string_lossy().to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_local_image_path() {
        assert!(is_local_image_path("images/sample.png"));
        assert!(is_local_image_path("C:\\images\\sample.jpg"));
        assert!(!is_local_image_path("http://example.com/img.png"));
        assert!(!is_local_image_path("https://example.com/img.png"));
        assert!(!is_local_image_path("data:image/png;base64,12345"));
    }
}

