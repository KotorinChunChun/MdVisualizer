use crate::errors::{AppError, AppResult};
use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use chrono::{DateTime, Local};
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use regex::Regex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    Markdown,
    Svg,
    Mermaid,
    Drawio,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocumentSourceKind {
    Local,
    SharePoint,
}

#[derive(Serialize, Debug, Clone)]
pub struct MarkdownLoadResult {
    pub path: String,
    pub kind: DocumentKind,
    pub content: String,
    pub base_dir: String,
    pub image_paths: Vec<String>,
    pub encoding: String,
    pub size_bytes: u64,
    pub modified_at: String,
    pub revision: String,
    pub source: DocumentSourceKind,
    pub web_url: Option<String>,
    pub etag: Option<String>,
}

pub(crate) fn content_revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn document_kind(path: &Path) -> Option<DocumentKind> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md") | Some("markdown") => Some(DocumentKind::Markdown),
        Some("svg") => Some(DocumentKind::Svg),
        Some("mmd") | Some("mermaid") => Some(DocumentKind::Mermaid),
        Some("drawio") => Some(DocumentKind::Drawio),
        _ => None,
    }
}

pub fn is_supported_document(path: &Path) -> bool {
    document_kind(path).is_some()
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
    let kind = document_kind(&path)
        .ok_or_else(|| AppError::UnsupportedDocument(normalized_path.to_string()))?;
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
    let image_paths = if kind == DocumentKind::Markdown {
        extract_image_paths(&content, base_path)
    } else {
        Vec::new()
    };

    Ok(MarkdownLoadResult {
        path: canonical_path.to_string_lossy().to_string(),
        kind,
        content,
        base_dir,
        image_paths,
        encoding,
        size_bytes: metadata.len(),
        modified_at,
        revision: content_revision(&bytes),
        source: DocumentSourceKind::Local,
        web_url: None,
        etag: None,
    })
}

pub(crate) fn decode_markdown(bytes: &[u8]) -> (String, String) {
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

/// Markdown本文中の画像参照 (`![alt](path)`、Obsidian画像埋め込み、`<img src="path">`) からローカル絶対パスを抽出
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

    // 2. Obsidian画像埋め込み ![[path]] / [[path]]
    let obsidian_img_re = Regex::new(r"!?\[\[([^\]\r\n|]+)(?:\|[^\]\r\n]*)?\]\]").unwrap();
    for cap in obsidian_img_re.captures_iter(content) {
        if let Some(src) = cap.get(1) {
            let src_str = src.as_str().trim();
            if is_local_image_path(src_str) && is_image_filename(src_str) {
                if let Some(resolved) = resolve_image_path(src_str, base_dir) {
                    results.push(resolved);
                }
            }
        }
    }

    // 3. HTML <img> 記法
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

fn is_image_filename(src: &str) -> bool {
    Regex::new(r"(?i)\.(?:avif|bmp|drawio|gif|ico|jpe?g|mmd|mermaid|png|svg|tiff?|webp)(?:[?#].*)?$")
        .unwrap()
        .is_match(src)
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
    fn extracts_obsidian_image_embeds_but_not_note_links() {
        let directory = tempfile::tempdir().unwrap();
        let image = directory.path().join("構成図.png");
        let drawio = directory.path().join("構成図.drawio");
        let mermaid = directory.path().join("処理.mmd");
        std::fs::write(&image, b"image").unwrap();
        std::fs::write(&drawio, b"<mxfile/>").unwrap();
        std::fs::write(&mermaid, b"flowchart LR\nA --> B").unwrap();

        let paths = extract_image_paths(
            "![[構成図.png|システム構成]]\n[[構成図.png]]\n![[構成図.drawio]]\n![Mermaid](処理.mmd)\n[[設計ノート.md]]",
            directory.path(),
        );

        assert_eq!(paths, vec![
            mermaid.canonicalize().unwrap().to_string_lossy().into_owned(),
            drawio.canonicalize().unwrap().to_string_lossy().into_owned(),
            image.canonicalize().unwrap().to_string_lossy().into_owned(),
        ]);
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

    #[test]
    fn classifies_every_supported_document_extension_case_insensitively() {
        assert_eq!(document_kind(Path::new("readme.md")), Some(DocumentKind::Markdown));
        assert_eq!(document_kind(Path::new("README.MARKDOWN")), Some(DocumentKind::Markdown));
        assert_eq!(document_kind(Path::new("diagram.svg")), Some(DocumentKind::Svg));
        assert_eq!(document_kind(Path::new("flow.MMD")), Some(DocumentKind::Mermaid));
        assert_eq!(document_kind(Path::new("flow.mermaid")), Some(DocumentKind::Mermaid));
        assert_eq!(document_kind(Path::new("system.DRAWIO")), Some(DocumentKind::Drawio));
        assert_eq!(document_kind(Path::new("image.png")), None);
    }

    #[test]
    fn loads_svg_mermaid_and_drawio_as_standalone_documents_without_image_references() {
        let directory = tempfile::tempdir().unwrap();
        let svg = directory.path().join("diagram.svg");
        let mermaid = directory.path().join("flow.mmd");
        let drawio = directory.path().join("system.drawio");
        std::fs::write(&svg, r#"<svg><image href="nested.png"/></svg>"#).unwrap();
        std::fs::write(&mermaid, "flowchart LR\n  A --> B").unwrap();
        std::fs::write(&drawio, "<mxfile><diagram/></mxfile>").unwrap();

        let loaded_svg = load_markdown(&svg.to_string_lossy()).unwrap();
        assert_eq!(loaded_svg.kind, DocumentKind::Svg);
        assert!(loaded_svg.image_paths.is_empty());

        let loaded_mermaid = load_markdown(&mermaid.to_string_lossy()).unwrap();
        assert_eq!(loaded_mermaid.kind, DocumentKind::Mermaid);
        assert!(loaded_mermaid.image_paths.is_empty());
        assert!(loaded_mermaid.content.contains("A --> B"));

        let loaded_drawio = load_markdown(&drawio.to_string_lossy()).unwrap();
        assert_eq!(loaded_drawio.kind, DocumentKind::Drawio);
        assert!(loaded_drawio.image_paths.is_empty());
        assert!(loaded_drawio.content.contains("mxfile"));
    }

    #[test]
    fn rejects_files_outside_the_supported_document_set() {
        let directory = tempfile::tempdir().unwrap();
        let image = directory.path().join("image.png");
        std::fs::write(&image, b"png").unwrap();
        assert!(matches!(
            load_markdown(&image.to_string_lossy()),
            Err(AppError::UnsupportedDocument(_))
        ));
    }
}
