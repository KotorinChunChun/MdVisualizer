//! Encoding-preserving, conflict-safe Markdown document saves.

use crate::errors::{AppError, AppResult};
use crate::file_lock::{atomic_write, with_lock};
use crate::markdown::{
    content_revision, document_kind, load_markdown, DocumentKind, MarkdownLoadResult,
};
use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMarkdownRequest {
    pub path: String,
    pub content: String,
    pub expected_revision: String,
    #[serde(default)]
    pub staged_asset_ids: Vec<String>,
}

struct OriginalDocument {
    text: String,
    encoding: &'static Encoding,
    bom: &'static [u8],
}

pub fn save_markdown(request: SaveMarkdownRequest) -> AppResult<MarkdownLoadResult> {
    let requested = PathBuf::from(&request.path);
    if document_kind(&requested) != Some(DocumentKind::Markdown) {
        return Err(AppError::UnsupportedDocument(request.path));
    }
    if !requested.exists() {
        return Err(AppError::FileNotFound(request.path));
    }
    let path = requested.canonicalize().map_err(|error| {
        AppError::IoError(format!("canonicalize {}: {error}", requested.display()))
    })?;
    let loaded = with_lock(&path, || save_locked(&path, &request))?;
    Ok(loaded)
}

pub fn save_markdown_with_assets(
    request: SaveMarkdownRequest,
    staging: &crate::asset_staging::AssetStagingManager,
) -> AppResult<MarkdownLoadResult> {
    let requested = PathBuf::from(&request.path);
    if document_kind(&requested) != Some(DocumentKind::Markdown) {
        return Err(AppError::UnsupportedDocument(request.path));
    }
    if !requested.exists() {
        return Err(AppError::FileNotFound(request.path));
    }
    let path = requested.canonicalize().map_err(|error| {
        AppError::IoError(format!("canonicalize {}: {error}", requested.display()))
    })?;
    with_lock(&path, || {
        staging.commit_with(&path, &request.staged_asset_ids, || {
            save_locked(&path, &request)
        })
    })
}

fn save_locked(path: &Path, request: &SaveMarkdownRequest) -> AppResult<MarkdownLoadResult> {
    let bytes = fs::read(path)
        .map_err(|error| AppError::IoError(format!("read {}: {error}", path.display())))?;
    let current_revision = content_revision(&bytes);
    if current_revision != request.expected_revision {
        return Err(AppError::Conflict(
            "Markdown document changed after it was opened; reload it before saving.".into(),
        ));
    }

    let original = decode_original(&bytes);
    let content = preserve_line_endings(&original.text, &request.content);
    let payload = encode_payload(original.encoding, &content)?;
    let mut output = Vec::with_capacity(original.bom.len() + payload.len());
    output.extend_from_slice(original.bom);
    output.extend_from_slice(&payload);
    atomic_write(path, &output)?;
    load_markdown(&path.to_string_lossy())
}

fn decode_original(bytes: &[u8]) -> OriginalDocument {
    let (encoding, bom, payload): (&'static Encoding, &'static [u8], &[u8]) =
        if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            (UTF_8, &[0xef, 0xbb, 0xbf], &bytes[3..])
        } else if bytes.starts_with(&[0xff, 0xfe]) {
            (UTF_16LE, &[0xff, 0xfe], &bytes[2..])
        } else if bytes.starts_with(&[0xfe, 0xff]) {
            (UTF_16BE, &[0xfe, 0xff], &bytes[2..])
        } else if std::str::from_utf8(bytes).is_ok() {
            (UTF_8, &[], bytes)
        } else {
            let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
            detector.feed(bytes, true);
            let detected = detector.guess(None, Utf8Detection::Allow);
            let (detected_text, _, _) = detected.decode(bytes);
            let (shift_jis_text, _, shift_jis_had_errors) = SHIFT_JIS.decode(bytes);
            if !shift_jis_had_errors
                && contains_japanese(&shift_jis_text)
                && !contains_japanese(&detected_text)
            {
                (SHIFT_JIS, &[], bytes)
            } else {
                (detected, &[], bytes)
            }
        };
    let text = if std::ptr::eq(encoding, UTF_16LE) {
        decode_utf16(payload, u16::from_le_bytes)
    } else if std::ptr::eq(encoding, UTF_16BE) {
        decode_utf16(payload, u16::from_be_bytes)
    } else {
        encoding.decode(payload).0.into_owned()
    };
    OriginalDocument {
        text,
        encoding,
        bom,
    }
}

fn decode_utf16(payload: &[u8], decode: fn([u8; 2]) -> u16) -> String {
    let units = payload
        .chunks_exact(2)
        .map(|chunk| decode([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&units)
}

fn encode_payload(encoding: &'static Encoding, content: &str) -> AppResult<Vec<u8>> {
    if std::ptr::eq(encoding, UTF_16LE) {
        return Ok(content.encode_utf16().flat_map(u16::to_le_bytes).collect());
    }
    if std::ptr::eq(encoding, UTF_16BE) {
        return Ok(content.encode_utf16().flat_map(u16::to_be_bytes).collect());
    }
    let (encoded, _, had_errors) = encoding.encode(content);
    if had_errors {
        return Err(AppError::IoError(format!(
            "Cannot preserve {} while writing Markdown: the edited text contains unsupported characters.",
            encoding.name()
        )));
    }
    Ok(encoded.into_owned())
}

fn preserve_line_endings(original: &str, edited: &str) -> String {
    let original_without_crlf = original.replace("\r\n", "");
    let uses_crlf = original.contains("\r\n") && !original_without_crlf.contains('\n');
    let uses_cr = original.contains('\r') && !original.contains('\n');
    if uses_crlf {
        edited.replace("\r\n", "\n").replace('\n', "\r\n")
    } else if uses_cr {
        edited.replace("\r\n", "\n").replace('\n', "\r")
    } else {
        edited.to_string()
    }
}

fn contains_japanese(value: &str) -> bool {
    value.chars().any(|character| matches!(character,
        '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ff66}'..='\u{ff9f}'
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn request(path: &Path, content: &str) -> SaveMarkdownRequest {
        let bytes = fs::read(path).unwrap();
        SaveMarkdownRequest {
            path: path.to_string_lossy().into_owned(),
            content: content.into(),
            expected_revision: content_revision(&bytes),
            staged_asset_ids: vec![],
        }
    }

    #[test]
    fn saves_utf8_markdown_and_returns_the_new_revision() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "# old\n").unwrap();
        let original_revision = content_revision(&fs::read(&path).unwrap());

        let result = save_markdown(request(&path, "# new\n")).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "# new\n");
        assert_ne!(result.revision, original_revision);
        assert_eq!(result.content, "# new\n");
    }

    #[test]
    fn rejects_a_stale_revision_without_overwriting() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "original").unwrap();
        let stale = request(&path, "edited");
        fs::write(&path, "external").unwrap();

        let result = save_markdown(stale);

        assert!(matches!(result, Err(AppError::Conflict(_))));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }

    #[test]
    fn preserves_utf16_bom_and_crlf() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend(
            "一行目\r\n二行目\r\n"
                .encode_utf16()
                .flat_map(u16::to_le_bytes),
        );
        fs::write(&path, bytes).unwrap();

        save_markdown(request(&path, "更新\n内容\n")).unwrap();

        let saved = fs::read(&path).unwrap();
        assert!(saved.starts_with(&[0xff, 0xfe]));
        let decoded = decode_utf16(&saved[2..], u16::from_le_bytes);
        assert_eq!(decoded, "更新\r\n内容\r\n");
    }

    #[test]
    fn rejects_characters_that_the_original_encoding_cannot_represent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        let (encoded, _, _) = SHIFT_JIS.encode("日本語\r\n");
        fs::write(&path, &encoded).unwrap();

        let result = save_markdown(request(&path, "日本語😀\n"));

        assert!(
            matches!(result, Err(AppError::IoError(message)) if message.contains("unsupported characters"))
        );
        assert_eq!(fs::read(&path).unwrap(), encoded.as_ref());
    }

    #[test]
    fn commits_staged_assets_together_with_the_markdown_save() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "old").unwrap();
        let staging = crate::asset_staging::AssetStagingManager::new().unwrap();
        let staged = staging
            .stage(&path.to_string_lossy(), "image.png", b"png-data")
            .unwrap();
        let mut save = request(&path, "![image](image.png)");
        save.staged_asset_ids = vec![staged.id];

        save_markdown_with_assets(save, &staging).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "![image](image.png)");
        assert_eq!(fs::read(dir.path().join("image.png")).unwrap(), b"png-data");
    }

    #[test]
    fn rolls_back_staged_assets_when_the_document_revision_is_stale() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "old").unwrap();
        let staging = crate::asset_staging::AssetStagingManager::new().unwrap();
        let staged = staging
            .stage(&path.to_string_lossy(), "image.png", b"png-data")
            .unwrap();
        let mut save = request(&path, "![image](image.png)");
        save.staged_asset_ids = vec![staged.id];
        fs::write(&path, "external").unwrap();

        assert!(save_markdown_with_assets(save, &staging).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert!(!dir.path().join("image.png").exists());
    }
}
