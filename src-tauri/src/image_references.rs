//! Safe, encoding-preserving updates for Markdown image references.
//!
//! This module intentionally has no Tauri command annotations.  It is kept as
//! a small filesystem domain layer so commands can opt into the operations
//! without duplicating parsing, encoding, or rollback behaviour.

use crate::errors::{AppError, AppResult};
use crate::file_lock::{atomic_write, with_lock};
use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;
use std::borrow::Cow;
use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Outcome of a successful image rename transaction.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameImageResult {
    pub old_path: String,
    pub new_path: String,
    pub updated_documents: Vec<String>,
    pub updated_references: usize,
}

/// Changes exactly one image caption, after confirming that the image source
/// at `source_offset` is still the value the caller originally rendered.
///
/// `source_offset` is a JavaScript string offset (UTF-16 code units), which is
/// the coordinate system emitted by remark's source positions in the frontend.
pub fn update_image_caption(
    markdown_path: &Path,
    source_offset: usize,
    expected_source: &str,
    caption: &str,
) -> AppResult<()> {
    with_lock(markdown_path, || {
        let document = read_document(markdown_path)?;
        let byte_offset =
            utf16_offset_to_byte_index(&document.text, source_offset).ok_or_else(|| {
                conflict_error("the requested image position is no longer at a character boundary")
            })?;
        let reference = parse_image_at(&document.text, byte_offset)
            .ok_or_else(|| conflict_error("the requested image reference no longer exists"))?;
        if reference.source != expected_source {
            return Err(conflict_error(
                "the image source changed before its caption could be saved",
            ));
        }

        let updated = replace_caption(&document.text, &reference, caption);
        let encoded = document.encode(&updated)?;
        atomic_write(markdown_path, &encoded)
    })
}

/// Renames an image and every local reference to that exact file below the
/// directory containing `markdown_path`.
///
/// All documents are read and encoded before any mutation begins.  Markdown
/// files are atomically replaced one by one; should an update or final image
/// rename fail, prior document replacements are restored from their original
/// bytes.  The image is renamed only after documents are successfully written,
/// so it remains at its original path when preparation/document updates fail.
pub fn rename_image_and_references(
    markdown_path: &Path,
    image_path: &Path,
    new_filename: &str,
) -> AppResult<RenameImageResult> {
    rename_image_and_references_with_options(markdown_path, image_path, new_filename, false)
}

pub fn rename_image_and_references_with_options(
    markdown_path: &Path,
    image_path: &Path,
    new_filename: &str,
    overwrite: bool,
) -> AppResult<RenameImageResult> {
    validate_filename(new_filename)?;
    let markdown_path = canonical_existing_path(markdown_path, "Markdown file")?;
    let old_image_path = canonical_existing_path(image_path, "Image file")?;
    let image_parent = old_image_path
        .parent()
        .ok_or_else(|| AppError::IoError("Image file has no parent directory.".into()))?;
    let new_image_path = image_parent.join(new_filename);
    if new_image_path.exists() && !overwrite {
        return Err(AppError::IoError(format!(
            "Cannot rename image: target already exists: {}",
            new_image_path.display()
        )));
    }

    let root = markdown_path
        .parent()
        .ok_or_else(|| AppError::IoError("Markdown file has no parent directory.".into()))?;
    let markdown_files = collect_markdown_files(root)?;
    let mut changes = Vec::new();
    for path in markdown_files {
        let document = read_document(&path)?;
        let references = scan_image_references(&document.text);
        let mut replacements = Vec::new();
        for reference in references {
            if resolve_local_reference(&path, &reference.source).as_deref()
                == Some(old_image_path.as_path())
            {
                replacements.push((
                    reference.source_range,
                    renamed_source(&reference.source, new_filename),
                ));
            }
        }
        if replacements.is_empty() {
            continue;
        }
        let replacement_count = replacements.len();
        let updated_text = apply_replacements(&document.text, replacements);
        let updated_bytes = document.encode(&updated_text)?;
        changes.push(DocumentChange {
            path,
            original_bytes: document.original_bytes,
            updated_bytes,
            replacements: replacement_count,
        });
    }

    let updated_references = changes
        .iter()
        .map(|change| change.replacements)
        .sum::<usize>();

    let mut written = Vec::new();
    for change in &changes {
        let write_result = with_lock(&change.path, || {
            atomic_write(&change.path, &change.updated_bytes)
        });
        if let Err(error) = write_result {
            let rollback_error = rollback_documents(&written);
            return Err(with_rollback_context(error, rollback_error));
        }
        written.push(change);
    }

    let target_backup = if overwrite && new_image_path.exists() {
        Some(fs::read(&new_image_path).map_err(|error| AppError::IoError(format!("read existing image: {error}")))?)
    } else { None };
    if overwrite && new_image_path.exists() {
        fs::remove_file(&new_image_path).map_err(|error| AppError::IoError(format!("remove existing image: {error}")))?;
    }
    if let Err(error) = fs::rename(&old_image_path, &new_image_path)
        .map_err(|error| AppError::IoError(format!("rename image: {error}")))
    {
        if let Some(bytes) = target_backup.as_ref() { let _ = fs::write(&new_image_path, bytes); }
        let rollback_error = rollback_documents(&written);
        return Err(with_rollback_context(error, rollback_error));
    }

    Ok(RenameImageResult {
        old_path: old_image_path.to_string_lossy().into_owned(),
        new_path: new_image_path.to_string_lossy().into_owned(),
        updated_documents: changes
            .iter()
            .map(|change| change.path.to_string_lossy().into_owned())
            .collect(),
        updated_references,
    })
}

struct DocumentChange {
    path: PathBuf,
    original_bytes: Vec<u8>,
    updated_bytes: Vec<u8>,
    replacements: usize,
}

#[derive(Clone)]
struct TextDocument {
    text: String,
    original_bytes: Vec<u8>,
    encoding: &'static Encoding,
    bom: &'static [u8],
}

impl TextDocument {
    fn encode(&self, text: &str) -> AppResult<Vec<u8>> {
        let encoded = encode_text_payload(self.encoding, text)?;
        let mut result = Vec::with_capacity(self.bom.len() + encoded.len());
        result.extend_from_slice(self.bom);
        result.extend_from_slice(&encoded);
        Ok(result)
    }
}

fn encode_text_payload(encoding: &'static Encoding, text: &str) -> AppResult<Vec<u8>> {
    if std::ptr::eq(encoding, UTF_16LE) {
        return Ok(text
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect());
    }
    if std::ptr::eq(encoding, UTF_16BE) {
        return Ok(text
            .encode_utf16()
            .flat_map(|unit| unit.to_be_bytes())
            .collect());
    }
    let (encoded, _, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(AppError::IoError(format!(
            "Cannot preserve {} while writing Markdown: the new text contains unsupported characters.",
            encoding.name()
        )));
    }
    Ok(encoded.into_owned())
}

#[derive(Debug, Clone)]
struct ImageReference {
    source: String,
    source_range: Range<usize>,
    caption: CaptionLocation,
}

#[derive(Debug, Clone)]
enum CaptionLocation {
    Markdown(Range<usize>),
    HtmlValue {
        range: Range<usize>,
        quote: Option<char>,
    },
    HtmlBareAttribute(Range<usize>),
    HtmlMissing {
        insert_at: usize,
    },
    /// Obsidian embeds are renamed through `source_range`.
    Ignored,
}

fn read_document(path: &Path) -> AppResult<TextDocument> {
    let bytes = fs::read(path)
        .map_err(|error| AppError::IoError(format!("read {}: {error}", path.display())))?;
    let (encoding, bom, payload): (&'static Encoding, &'static [u8], &[u8]) =
        if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            (UTF_8, &[0xef, 0xbb, 0xbf], &bytes[3..])
        } else if bytes.starts_with(&[0xff, 0xfe]) {
            (UTF_16LE, &[0xff, 0xfe], &bytes[2..])
        } else if bytes.starts_with(&[0xfe, 0xff]) {
            (UTF_16BE, &[0xfe, 0xff], &bytes[2..])
        } else if std::str::from_utf8(&bytes).is_ok() {
            (UTF_8, &[], &bytes)
        } else {
            let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
            detector.feed(&bytes, true);
            let detected = detector.guess(None, Utf8Detection::Allow);
            let (detected_text, _, _) = detected.decode(&bytes);
            let (shift_jis_text, _, shift_jis_had_errors) = SHIFT_JIS.decode(&bytes);
            if !shift_jis_had_errors
                && contains_japanese(&shift_jis_text)
                && !contains_japanese(&detected_text)
            {
                (SHIFT_JIS, &[], &bytes)
            } else {
                (detected, &[], &bytes)
            }
        };
    let (text, _, _) = encoding.decode(payload);
    Ok(TextDocument {
        text: text.into_owned(),
        original_bytes: bytes,
        encoding,
        bom,
    })
}

fn contains_japanese(value: &str) -> bool {
    value.chars().any(|character| {
        matches!(character,
            '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ff66}'..='\u{ff9f}'
        )
    })
}

fn canonical_existing_path(path: &Path, label: &str) -> AppResult<PathBuf> {
    if !path.exists() {
        return Err(AppError::FileNotFound(format!(
            "{}: {}",
            label,
            path.display()
        )));
    }
    path.canonicalize()
        .map_err(|error| AppError::IoError(format!("canonicalize {}: {error}", path.display())))
}

fn validate_filename(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains(['/', '\\'])
        || Path::new(value).is_absolute()
        || Path::new(value).file_name().and_then(|name| name.to_str()) != Some(value)
    {
        return Err(AppError::IoError(
            "The new image name must be one plain filename, without a directory.".into(),
        ));
    }
    Ok(())
}

fn collect_markdown_files(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry =
            entry.map_err(|error| AppError::IoError(format!("walk Markdown files: {error}")))?;
        if !entry.file_type().is_file() || !is_markdown_file(entry.path()) {
            continue;
        }
        files.push(entry.into_path());
    }
    files.sort();
    Ok(files)
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn scan_image_references(text: &str) -> Vec<ImageReference> {
    let mut references = Vec::new();
    let mut index = 0;
    while index < text.len() {
        if text[index..].starts_with('`') {
            index = skip_backtick_code(text, index);
            continue;
        }
        if text[index..].starts_with("![") {
            if let Some(reference) = parse_markdown_image_at(text, index) {
                let next = reference.source_range.end.saturating_add(1);
                references.push(reference);
                index = next.min(text.len());
                continue;
            }
        }
        if text[index..].starts_with("![[") {
            if let Some(reference) = parse_obsidian_image_at(text, index) {
                let next = reference.source_range.end;
                references.push(reference);
                index = next.min(text.len());
                continue;
            }
        }
        if is_html_img_start(text, index) {
            if let Some((reference, end)) = parse_html_image_at(text, index) {
                references.push(reference);
                index = end;
                continue;
            }
        }
        index = next_char_index(text, index);
    }
    references
}

fn parse_image_at(text: &str, start: usize) -> Option<ImageReference> {
    if text.get(start..)?.starts_with("![") {
        parse_markdown_image_at(text, start)
    } else if is_html_img_start(text, start) {
        parse_html_image_at(text, start).map(|(reference, _)| reference)
    } else {
        None
    }
}

fn parse_markdown_image_at(text: &str, start: usize) -> Option<ImageReference> {
    let bytes = text.as_bytes();
    if bytes.get(start..start + 2)? != b"![" {
        return None;
    }
    let alt_start = start + 2;
    let alt_end = find_unescaped_byte(bytes, alt_start, b']')?;
    if bytes.get(alt_end + 1)? != &b'(' {
        return None;
    }
    let body_start = alt_end + 2;
    let body_end = find_matching_markdown_paren(bytes, body_start)?;
    let source_range = parse_markdown_destination(text, body_start, body_end)?;
    Some(ImageReference {
        source: text[source_range.clone()].to_string(),
        source_range,
        caption: CaptionLocation::Markdown(alt_start..alt_end),
    })
}

fn parse_obsidian_image_at(text: &str, start: usize) -> Option<ImageReference> {
    let prefix_end = start.checked_add(3)?;
    if text.get(start..prefix_end)? != "![[" {
        return None;
    }
    let close = text[prefix_end..].find("]]")? + prefix_end;
    let inner = &text[prefix_end..close];
    let path_end = inner.find('|').unwrap_or(inner.len());
    let path = inner[..path_end].trim();
    if path.is_empty() {
        return None;
    }
    let source_start = prefix_end + inner[..path_end].find(path)?;
    let source_end = source_start + path.len();
    Some(ImageReference {
        source: path.to_string(),
        source_range: source_start..source_end,
        caption: CaptionLocation::Ignored,
    })
}

fn find_unescaped_byte(bytes: &[u8], mut index: usize, target: u8) -> Option<usize> {
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = index.saturating_add(2);
            continue;
        }
        if bytes[index] == target {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn find_matching_markdown_paren(bytes: &[u8], mut index: usize) -> Option<usize> {
    let mut nesting = 0_usize;
    let mut quote = None;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\\' {
            index = index.saturating_add(2);
            continue;
        }
        if let Some(current_quote) = quote {
            if byte == current_quote {
                quote = None;
            }
            index += 1;
            continue;
        }
        if matches!(byte, b'\'' | b'\"') {
            quote = Some(byte);
        } else if byte == b'(' {
            nesting += 1;
        } else if byte == b')' {
            if nesting == 0 {
                return Some(index);
            }
            nesting -= 1;
        }
        index += 1;
    }
    None
}

fn parse_markdown_destination(
    text: &str,
    body_start: usize,
    body_end: usize,
) -> Option<Range<usize>> {
    let bytes = text.as_bytes();
    let mut start = body_start;
    while start < body_end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    if start >= body_end {
        return None;
    }
    if bytes[start] == b'<' {
        let end = find_unescaped_byte(&bytes[..body_end], start + 1, b'>')?;
        return (end > start + 1).then_some(start + 1..end);
    }
    let mut index = start;
    let mut nesting = 0_usize;
    while index < body_end {
        let byte = bytes[index];
        if byte == b'\\' {
            index = index.saturating_add(2);
            continue;
        }
        if byte == b'(' {
            nesting += 1;
        } else if byte == b')' && nesting > 0 {
            nesting -= 1;
        } else if byte.is_ascii_whitespace() && nesting == 0 {
            break;
        }
        index += 1;
    }
    (index > start).then_some(start..index)
}

fn is_html_img_start(text: &str, start: usize) -> bool {
    let bytes = text.as_bytes();
    if start.checked_add(4).is_none_or(|end| end > bytes.len())
        || !bytes[start..start + 4].eq_ignore_ascii_case(b"<img")
    {
        return false;
    }
    matches!(bytes.get(start + 4), Some(byte) if byte.is_ascii_whitespace() || matches!(byte, b'/' | b'>'))
}

fn parse_html_image_at(text: &str, start: usize) -> Option<(ImageReference, usize)> {
    let tag_end = find_html_tag_end(text, start + 4)?;
    let bytes = text.as_bytes();
    let mut index = start + 4;
    let mut source = None;
    let mut caption = None;
    while index < tag_end {
        while index < tag_end && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= tag_end || bytes[index] == b'/' {
            index += 1;
            continue;
        }
        let attribute_start = index;
        while index < tag_end && is_html_attribute_char(bytes[index]) {
            index += 1;
        }
        if attribute_start == index {
            index += 1;
            continue;
        }
        let attribute_end = index;
        let name = &text[attribute_start..attribute_end];
        while index < tag_end && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= tag_end || bytes[index] != b'=' {
            if name.eq_ignore_ascii_case("alt") {
                caption = Some(CaptionLocation::HtmlBareAttribute(
                    attribute_start..attribute_end,
                ));
            }
            continue;
        }
        index += 1;
        while index < tag_end && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= tag_end {
            break;
        }
        let (value_range, quote, next) = if matches!(bytes[index], b'\'' | b'\"') {
            let quote = bytes[index];
            let value_start = index + 1;
            let value_end = find_unescaped_byte(&bytes[..tag_end], value_start, quote)?;
            (
                value_start..value_end,
                Some(char::from(quote)),
                value_end + 1,
            )
        } else {
            let value_start = index;
            while index < tag_end && !bytes[index].is_ascii_whitespace() && bytes[index] != b'>' {
                index += 1;
            }
            (value_start..index, None, index)
        };
        if name.eq_ignore_ascii_case("src") {
            source = Some((text[value_range.clone()].to_string(), value_range));
        } else if name.eq_ignore_ascii_case("alt") {
            caption = Some(CaptionLocation::HtmlValue {
                range: value_range,
                quote,
            });
        }
        index = next;
    }
    let (source, source_range) = source?;
    let insert_at = html_alt_insert_position(text, start, tag_end);
    Some((
        ImageReference {
            source,
            source_range,
            caption: caption.unwrap_or(CaptionLocation::HtmlMissing { insert_at }),
        },
        tag_end + 1,
    ))
}

fn find_html_tag_end(text: &str, mut index: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut quote = None;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(current_quote) = quote {
            if byte == current_quote {
                quote = None;
            }
        } else if matches!(byte, b'\'' | b'\"') {
            quote = Some(byte);
        } else if byte == b'>' {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn is_html_attribute_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-')
}

fn html_alt_insert_position(text: &str, start: usize, tag_end: usize) -> usize {
    let bytes = text.as_bytes();
    let mut index = tag_end;
    while index > start && bytes[index - 1].is_ascii_whitespace() {
        index -= 1;
    }
    if index > start && bytes[index - 1] == b'/' {
        index - 1
    } else {
        tag_end
    }
}

fn replace_caption(text: &str, reference: &ImageReference, caption: &str) -> String {
    match &reference.caption {
        CaptionLocation::Markdown(range) => {
            replace_range(text, range.clone(), &escape_markdown_alt(caption))
        }
        CaptionLocation::HtmlValue { range, quote } => {
            replace_range(text, range.clone(), &escape_html_attribute(caption, *quote))
        }
        CaptionLocation::HtmlBareAttribute(range) => replace_range(
            text,
            range.clone(),
            &format!("alt=\"{}\"", escape_html_attribute(caption, Some('"'))),
        ),
        CaptionLocation::HtmlMissing { insert_at } => {
            let mut result = String::with_capacity(text.len() + caption.len() + 8);
            result.push_str(&text[..*insert_at]);
            result.push_str(&format!(
                " alt=\"{}\"",
                escape_html_attribute(caption, Some('"'))
            ));
            result.push_str(&text[*insert_at..]);
            result
        }
        CaptionLocation::Ignored => text.to_string(),
    }
}

fn escape_markdown_alt(value: &str) -> Cow<'_, str> {
    if !value.contains(['\\', '[', ']']) {
        return Cow::Borrowed(value);
    }
    Cow::Owned(
        value
            .replace('\\', "\\\\")
            .replace('[', "\\[")
            .replace(']', "\\]"),
    )
}

fn escape_html_attribute(value: &str, quote: Option<char>) -> String {
    let mut escaped = value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    match quote {
        Some('"') => escaped = escaped.replace('"', "&quot;"),
        Some('\'') => escaped = escaped.replace('\'', "&#39;"),
        None => {
            escaped = escaped
                .replace('"', "&quot;")
                .replace('\'', "&#39;")
                .replace('=', "&#61;")
                .replace('`', "&#96;")
                .replace(' ', "&#32;");
        }
        Some(_) => {}
    }
    escaped
}

fn replace_range(text: &str, range: Range<usize>, replacement: &str) -> String {
    let mut result =
        String::with_capacity(text.len() - (range.end - range.start) + replacement.len());
    result.push_str(&text[..range.start]);
    result.push_str(replacement);
    result.push_str(&text[range.end..]);
    result
}

fn apply_replacements(text: &str, mut replacements: Vec<(Range<usize>, String)>) -> String {
    replacements.sort_by(|left, right| right.0.start.cmp(&left.0.start));
    replacements
        .into_iter()
        .fold(text.to_string(), |mut value, (range, replacement)| {
            value.replace_range(range, &replacement);
            value
        })
}

fn renamed_source(source: &str, new_filename: &str) -> String {
    let suffix_index = source.find(['?', '#']).unwrap_or(source.len());
    let (path_part, suffix) = source.split_at(suffix_index);
    let directory_end = path_part
        .rfind(['/', '\\'])
        .map(|index| index + 1)
        .unwrap_or(0);
    format!("{}{}{}", &path_part[..directory_end], new_filename, suffix)
}

fn resolve_local_reference(markdown_path: &Path, source: &str) -> Option<PathBuf> {
    let path_text = source.split(['?', '#']).next()?;
    let lower = path_text.to_ascii_lowercase();
    if path_text.is_empty()
        || lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("//")
    {
        return None;
    }
    let path_text = unescape_markdown_destination(path_text);
    let raw = Path::new(&path_text);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        markdown_path.parent()?.join(raw)
    };
    candidate.canonicalize().ok()
}

fn unescape_markdown_destination(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            result.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else {
            result.push(character);
        }
    }
    if escaped {
        result.push('\\');
    }
    result
}

fn rollback_documents(written: &[&DocumentChange]) -> Option<AppError> {
    let mut errors = Vec::new();
    for change in written.iter().rev() {
        if let Err(error) = with_lock(&change.path, || {
            atomic_write(&change.path, &change.original_bytes)
        }) {
            errors.push(error.to_string());
        }
    }
    (!errors.is_empty()).then(|| {
        AppError::IoError(format!(
            "rollback Markdown documents: {}",
            errors.join("; ")
        ))
    })
}

fn with_rollback_context(error: AppError, rollback_error: Option<AppError>) -> AppError {
    match rollback_error {
        Some(rollback_error) => {
            AppError::IoError(format!("{error}; rollback also failed: {rollback_error}"))
        }
        None => error,
    }
}

fn conflict_error(message: &str) -> AppError {
    AppError::IoError(format!("Image reference conflict: {message}"))
}

fn utf16_offset_to_byte_index(text: &str, target: usize) -> Option<usize> {
    if target == 0 {
        return Some(0);
    }
    let mut utf16_offset = 0;
    for (byte_index, character) in text.char_indices() {
        if utf16_offset == target {
            return Some(byte_index);
        }
        utf16_offset += character.len_utf16();
        if utf16_offset > target {
            return None;
        }
    }
    (utf16_offset == target).then_some(text.len())
}

fn next_char_index(text: &str, index: usize) -> usize {
    index
        + text[index..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1)
}

fn skip_backtick_code(text: &str, start: usize) -> usize {
    let bytes = text.as_bytes();
    let mut delimiter_end = start;
    while delimiter_end < bytes.len() && bytes[delimiter_end] == b'`' {
        delimiter_end += 1;
    }
    let delimiter = &text[start..delimiter_end];
    text[delimiter_end..]
        .find(delimiter)
        .map(|relative| delimiter_end + relative + delimiter.len())
        .unwrap_or(text.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::{SHIFT_JIS, UTF_16BE, UTF_16LE};
    use tempfile::tempdir;

    fn utf16_offset(text: &str, byte_index: usize) -> usize {
        text[..byte_index].encode_utf16().count()
    }

    fn encode_with_bom(encoding: &'static Encoding, bom: &[u8], text: &str) -> Vec<u8> {
        let encoded = encode_text_payload(encoding, text).unwrap();
        let mut bytes = bom.to_vec();
        bytes.extend_from_slice(&encoded);
        bytes
    }

    #[test]
    fn updates_markdown_caption_at_a_utf16_offset_and_preserves_utf8_bom_and_crlf() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("document.md");
        let text = "先頭\r\n![old](images/photo.png \"title\")\r\n";
        fs::write(&path, encode_with_bom(UTF_8, &[0xef, 0xbb, 0xbf], text)).unwrap();
        let offset = utf16_offset(text, text.find("![old]").unwrap());

        update_image_caption(&path, offset, "images/photo.png", "新しい [caption]").unwrap();

        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(&[0xef, 0xbb, 0xbf]));
        let written = std::str::from_utf8(&bytes[3..]).unwrap();
        assert_eq!(
            written,
            "先頭\r\n![新しい \\[caption\\]](images/photo.png \"title\")\r\n"
        );
    }

    #[test]
    fn updates_html_caption_while_preserving_quote_style_and_adds_missing_alt() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("document.md");
        let text = "<img class=shot src='images/photo.png?one#two' alt='old'>\n<img src=images/second.png />\n";
        fs::write(&path, text).unwrap();

        update_image_caption(&path, 0, "images/photo.png?one#two", "it's <new>").unwrap();
        let second_offset = utf16_offset(
            &fs::read_to_string(&path).unwrap(),
            fs::read_to_string(&path)
                .unwrap()
                .find("<img src=images/second.png")
                .unwrap(),
        );
        update_image_caption(&path, second_offset, "images/second.png", "second").unwrap();

        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "<img class=shot src='images/photo.png?one#two' alt='it&#39;s &lt;new&gt;'>\n<img src=images/second.png  alt=\"second\"/>\n"
        );
    }

    #[test]
    fn caption_update_rejects_a_stale_source_without_writing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("document.md");
        let original = "![old](images/current.png)\n";
        fs::write(&path, original).unwrap();

        let result = update_image_caption(&path, 0, "images/expected.png", "new");

        assert!(matches!(result, Err(AppError::IoError(message)) if message.contains("conflict")));
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
    }

    #[test]
    fn preserves_utf16_bom_and_newline_when_updating_caption() {
        for (encoding, bom) in [(UTF_16LE, &[0xff, 0xfe][..]), (UTF_16BE, &[0xfe, 0xff][..])] {
            let dir = tempdir().unwrap();
            let path = dir.path().join("utf16.md");
            let text = "![old](image.png)\r\n";
            fs::write(&path, encode_with_bom(encoding, bom, text)).unwrap();

            update_image_caption(&path, 0, "image.png", "新").unwrap();

            let bytes = fs::read(&path).unwrap();
            assert!(bytes.starts_with(bom));
            let (decoded, _, _) = encoding.decode(&bytes[bom.len()..]);
            assert_eq!(&*decoded, "![新](image.png)\r\n");
        }
    }

    #[test]
    fn renames_matching_relative_markdown_and_html_references_without_touching_others() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("images")).unwrap();
        fs::create_dir_all(root.join("nested")).unwrap();
        let image = root.join("images").join("photo.png");
        fs::write(&image, b"image").unwrap();
        fs::write(root.join("images").join("other.png"), b"other").unwrap();
        let main = root.join("main.md");
        fs::write(
            &main,
            "![first](images/photo.png \"kept title\")\n![second](images/photo.png?download=1#part)\n![other](images/other.png)\n",
        )
        .unwrap();
        fs::write(
            root.join("nested").join("other.MARKDOWN"),
            "<img alt='caption' src='../images/photo.png?x#fragment'>\n",
        )
        .unwrap();

        let result = rename_image_and_references(&main, &image, "renamed.png").unwrap();

        assert!(!image.exists());
        assert!(root.join("images").join("renamed.png").exists());
        assert_eq!(result.updated_references, 3);
        assert_eq!(result.updated_documents.len(), 2);
        assert_eq!(
            fs::read_to_string(&main).unwrap(),
            "![first](images/renamed.png \"kept title\")\n![second](images/renamed.png?download=1#part)\n![other](images/other.png)\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("nested").join("other.MARKDOWN")).unwrap(),
            "<img alt='caption' src='../images/renamed.png?x#fragment'>\n"
        );
    }

    #[test]
    fn renames_obsidian_mermaid_references() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let mermaid = root.join("flow.mmd");
        let markdown = root.join("main.md");
        fs::write(&mermaid, "flowchart LR\nA --> B\n").unwrap();
        fs::write(&markdown, "![[flow.mmd|処理フロー]]\n").unwrap();

        let result = rename_image_and_references(&markdown, &mermaid, "renamed.mmd").unwrap();

        assert!(!mermaid.exists());
        assert!(root.join("renamed.mmd").exists());
        assert_eq!(result.updated_references, 1);
        assert_eq!(
            fs::read_to_string(&markdown).unwrap(),
            "![[renamed.mmd|処理フロー]]\n"
        );
    }

    #[test]
    fn rename_preserves_shift_jis_and_crlf() {
        let dir = tempdir().unwrap();
        let image = dir.path().join("old.png");
        fs::write(&image, b"image").unwrap();
        let markdown = dir.path().join("shift-jis.md");
        let original = "日本語\r\n![画像](old.png)\r\n";
        let (bytes, _, had_errors) = SHIFT_JIS.encode(original);
        assert!(!had_errors);
        fs::write(&markdown, bytes).unwrap();

        rename_image_and_references(&markdown, &image, "new.png").unwrap();

        let written = fs::read(&markdown).unwrap();
        let (decoded, _, had_errors) = SHIFT_JIS.decode(&written);
        assert!(!had_errors);
        assert_eq!(&*decoded, "日本語\r\n![画像](new.png)\r\n");
    }

    #[test]
    fn rename_rejects_target_collision_and_invalid_filename() {
        let dir = tempdir().unwrap();
        let markdown = dir.path().join("main.md");
        let image = dir.path().join("old.png");
        let colliding = dir.path().join("new.png");
        fs::write(&markdown, "![x](old.png)").unwrap();
        fs::write(&image, b"old").unwrap();
        fs::write(&colliding, b"new").unwrap();

        assert!(rename_image_and_references(&markdown, &image, "new.png").is_err());
        assert!(rename_image_and_references(&markdown, &image, "../escape.png").is_err());
        assert!(image.exists());
        assert_eq!(fs::read_to_string(&markdown).unwrap(), "![x](old.png)");
    }

    #[test]
    fn rename_aborts_before_writes_when_a_shift_jis_document_cannot_encode_the_new_name() {
        let dir = tempdir().unwrap();
        let image = dir.path().join("old.png");
        fs::write(&image, b"image").unwrap();
        let utf8 = dir.path().join("main.md");
        fs::write(&utf8, "![one](old.png)\n").unwrap();
        let shift_jis = dir.path().join("legacy.markdown");
        let original = "日本語\r\n![two](old.png)\r\n";
        let (bytes, _, had_errors) = SHIFT_JIS.encode(original);
        assert!(!had_errors);
        fs::write(&shift_jis, bytes).unwrap();

        let result = rename_image_and_references(&utf8, &image, "emoji😀.png");

        assert!(
            matches!(result, Err(AppError::IoError(message)) if message.contains("unsupported characters"))
        );
        assert!(image.exists());
        assert!(!dir.path().join("emoji😀.png").exists());
        assert_eq!(fs::read_to_string(&utf8).unwrap(), "![one](old.png)\n");
        let written = fs::read(&shift_jis).unwrap();
        let (decoded, _, _) = SHIFT_JIS.decode(&written);
        assert_eq!(&*decoded, original);
    }

    #[test]
    fn ignores_image_looking_text_in_backtick_code() {
        let text = "`![not](old.png)`\n![real](old.png)\n";
        let references = scan_image_references(text);
        assert_eq!(references.len(), 1);
        assert_eq!(references[0].source, "old.png");
    }
}
