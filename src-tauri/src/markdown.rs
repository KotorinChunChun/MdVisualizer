use crate::errors::{AppError, AppResult};
use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use chrono::{DateTime, Local};
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
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
    pub encoding: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

fn normalize_webview_path(path: &str) -> &str {
    path.strip_prefix("/?/")
        .filter(|rest| {
            let bytes = rest.as_bytes();
            bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && bytes[2] == b'/'
        })
        .unwrap_or(path)
}

pub fn load_markdown(path_str: &str) -> AppResult<MarkdownLoadResult> {
    let normalized_path = normalize_webview_path(path_str);
    let path = PathBuf::from(normalized_path);
    if !path.exists() {
        return Err(AppError::FileNotFound(normalized_path.to_string()));
    }

    let bytes = fs::read(&path)
        .map_err(|e| AppError::IoError(format!("Failed to read markdown file: {}", e)))?;
    let (content, encoding) = decode_markdown(&bytes);
    let metadata = fs::metadata(&path)
        .map_err(|e| AppError::IoError(format!("Failed to read markdown metadata: {}", e)))?;
    let modified_at = metadata
        .modified()
        .ok()
        .map(|time| DateTime::<Local>::from(time).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "Unknown".to_string());

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
        encoding,
        size_bytes: metadata.len(),
        modified_at,
    })
}

fn decode_markdown(bytes: &[u8]) -> (String, String) {
    let (encoding, label, payload): (&'static Encoding, &str, &[u8]) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (UTF_8, "UTF-8 BOM", &bytes[3..])
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        (UTF_16LE, "UTF-16LE", &bytes[2..])
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (UTF_16BE, "UTF-16BE", &bytes[2..])
    } else if std::str::from_utf8(bytes).is_ok() {
        (UTF_8, "UTF-8", bytes)
    } else {
        let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
        detector.feed(bytes, true);
        let detected = detector.guess(None, Utf8Detection::Allow);
        let (detected_text, _, _) = detected.decode(bytes);
        let (shift_jis_text, _, shift_jis_had_errors) = SHIFT_JIS.decode(bytes);
        // Short Japanese Shift_JIS documents can otherwise be guessed as a
        // Western encoding. Prefer a lossless Shift_JIS decode only when it
        // actually produces Japanese characters and the guessed decode does not.
        if !shift_jis_had_errors && contains_japanese(&shift_jis_text) && !contains_japanese(&detected_text) {
            (SHIFT_JIS, "Shift_JIS", bytes)
        } else {
            (detected, detected.name(), bytes)
        }
    };
    let (decoded, _, _) = encoding.decode(payload);
    (decoded.into_owned(), label.to_string())
}

fn contains_japanese(value: &str) -> bool {
    value.chars().any(|character| matches!(character,
        '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ff66}'..='\u{ff9f}'
    ))
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

    #[test]
    fn normalizes_webview_windows_drive_path() {
        assert_eq!(
            normalize_webview_path("/?/C:/docs/readme.md"),
            "C:/docs/readme.md"
        );
        assert_eq!(normalize_webview_path("/var/docs/readme.md"), "/var/docs/readme.md");
    }

    #[test]
    fn decodes_utf16le_bom() {
        let (content, encoding) = decode_markdown(&[0xFF, 0xFE, b'A', 0]);
        assert_eq!(content, "A");
        assert_eq!(encoding, "UTF-16LE");
    }

    #[test]
    fn detects_utf8_bom_and_shift_jis() {
        let (utf8, utf8_encoding) = decode_markdown(&[0xEF, 0xBB, 0xBF, b'A']);
        assert_eq!(utf8, "A");
        assert_eq!(utf8_encoding, "UTF-8 BOM");

        let (encoded, _, _) = SHIFT_JIS.encode("日本語");
        let (shift_jis, shift_jis_encoding) = decode_markdown(&encoded);
        assert_eq!(shift_jis, "日本語");
        assert_eq!(shift_jis_encoding, "Shift_JIS");
    }
}
