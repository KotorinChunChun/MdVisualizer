//! 文書内参照の解析、診断、監視対象の抽出。
use crate::markdown::{load_markdown as do_load_markdown, DocumentKind, MarkdownLoadResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
#[derive(Serialize)]
pub struct DiagnosticItem {
    severity: String,
    kind: String,
    line: usize,
    reference: String,
    message: String,
}

fn heading_base_id(value: &str) -> String {
    let normalized = value.trim().to_lowercase();
    let mut slug = String::new();
    let mut separator = false;
    for character in normalized.chars() {
        if character.is_alphanumeric() {
            slug.push(character);
            separator = false;
        } else if !slug.is_empty() && !separator {
            slug.push('-');
            separator = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "section".to_string()
    } else {
        slug
    }
}

fn heading_id(value: &str, counts: &mut std::collections::HashMap<String, usize>) -> String {
    let base = heading_base_id(value);
    let count = counts
        .entry(base.clone())
        .and_modify(|value| *value += 1)
        .or_insert(1);
    if *count == 1 {
        base
    } else {
        format!("{}-{}", base, count)
    }
}

fn decode_reference(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

fn fence_marker(line: &str) -> Option<(char, usize, &str)> {
    let indentation = line.len() - line.trim_start_matches(' ').len();
    if indentation > 3 {
        return None;
    }
    let marker = line[indentation..].chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let count = line[indentation..]
        .chars()
        .take_while(|character| *character == marker)
        .count();
    (count >= 3).then(|| (marker, count, &line[indentation + count..]))
}

fn update_fence(fence: &mut Option<(char, usize)>, line: &str) {
    let Some((marker, count, remainder)) = fence_marker(line) else {
        return;
    };
    match *fence {
        None => *fence = Some((marker, count)),
        Some((open_marker, open_count))
            if marker == open_marker && count >= open_count && remainder.trim().is_empty() =>
        {
            *fence = None;
        }
        _ => {}
    }
}

fn atx_heading_title(line: &str) -> Option<&str> {
    let indentation = line.len() - line.trim_start_matches(' ').len();
    if indentation > 3 {
        return None;
    }
    let content = &line[indentation..];
    let hash_count = content
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&hash_count) {
        return None;
    }
    let rest = &content[hash_count..];
    if !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }
    let mut title = rest.trim();
    while title.ends_with('#') {
        let without_hash = title[..title.len() - 1].trim_end();
        if without_hash.len() == title.len() {
            break;
        }
        title = without_hash;
    }
    Some(title)
}

fn markdown_heading_ids(
    source: &str,
) -> (
    std::collections::HashSet<String>,
    std::collections::HashMap<String, usize>,
) {
    let mut counts = std::collections::HashMap::new();
    let mut ids = std::collections::HashSet::new();
    let mut bases = std::collections::HashMap::new();
    let mut fence = None;
    for line in source.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if fence.is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if let Some(title) = atx_heading_title(line) {
            let id = heading_id(title, &mut counts);
            let base = heading_base_id(title);
            *bases.entry(base).or_insert(0) += 1;
            ids.insert(id);
        }
    }
    (ids, bases)
}

fn diagnostic_reference_target(
    reference: &str,
    base: &Path,
    document_path: &Path,
) -> (PathBuf, Option<String>) {
    // Split before percent-decoding so an encoded '#' remains part of a file name.
    let (without_fragment, anchor) = reference
        .split_once('#')
        .map_or((reference, None), |(file, anchor)| {
            (file, Some(decode_reference(anchor)))
        });
    let path_part = without_fragment
        .split_once('?')
        .map_or(without_fragment, |(path, _)| path);
    let path_part = decode_reference(path_part).trim().to_string();
    let target = if path_part.is_empty() {
        document_path.to_path_buf()
    } else {
        let candidate = PathBuf::from(path_part);
        if candidate.is_absolute() {
            candidate
        } else {
            base.join(candidate)
        }
    };
    (target, anchor)
}

fn is_external_reference(reference: &str) -> bool {
    let value = decode_reference(reference).trim().to_ascii_lowercase();
    if value.starts_with("//") {
        return true;
    }
    let is_windows_path = value.as_bytes().get(1) == Some(&b':')
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic);
    !is_windows_path
        && value.find(':').is_some_and(|colon| {
            colon > 0
                && value[..colon].chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
                })
        })
}

fn markdown_references(line: &str) -> Vec<(String, bool)> {
    let pattern = regex::Regex::new(
        r#"(?x)(?P<image>!)?\[[^\]]*\]\(\s*(?:<(?P<bracket>[^>\r\n]*)>|(?P<plain>[^\s)\r\n]+))"#,
    )
    .unwrap();
    pattern
        .captures_iter(line)
        .filter_map(|capture| {
            let reference = capture
                .name("bracket")
                .or_else(|| capture.name("plain"))?
                .as_str()
                .trim()
                .to_string();
            Some((reference, capture.name("image").is_some()))
        })
        .collect()
}

fn html_image_references(line: &str) -> Vec<(String, bool)> {
    let image_tag = regex::Regex::new(r"(?is)<img\b[^>]*>").unwrap();
    let attribute = regex::Regex::new(
        r#"(?i)(?:^|\s)([a-z_:][a-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#,
    )
    .unwrap();
    image_tag
        .find_iter(line)
        .filter_map(|tag| {
            let mut source = None;
            let mut alt = None;
            for capture in attribute.captures_iter(tag.as_str()) {
                let name = capture.get(1)?.as_str();
                let value = capture
                    .get(2)
                    .or_else(|| capture.get(3))
                    .or_else(|| capture.get(4))
                    .map(|value| value.as_str().to_string())
                    .unwrap_or_default();
                if name.eq_ignore_ascii_case("src") {
                    source = Some(value);
                } else if name.eq_ignore_ascii_case("alt") {
                    alt = Some(value);
                }
            }
            source.map(|source| (source, alt.map_or(true, |value| value.trim().is_empty())))
        })
        .collect()
}

fn reference_target_path(reference: &str, base: &Path, document_path: &Path) -> PathBuf {
    let (target, _) = diagnostic_reference_target(reference, base, document_path);
    target.canonicalize().unwrap_or(target)
}

fn collect_document_watch_targets(loaded: &MarkdownLoadResult) -> Vec<String> {
    if loaded.kind != DocumentKind::Markdown {
        return vec![loaded.path.clone()];
    }
    let source = loaded.content.replace("\r\n", "\n");
    let base = PathBuf::from(&loaded.base_dir);
    let obsidian = regex::Regex::new(r#"!?\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]"#).unwrap();
    let mut result = vec![PathBuf::from(&loaded.path)];
    let mut fence = None;
    for line in source.lines() {
        if fence.is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        let mut refs: Vec<String> = markdown_references(line)
            .into_iter()
            .map(|(reference, _)| reference)
            .collect();
        refs.extend(
            html_image_references(line)
                .into_iter()
                .map(|(reference, _)| reference),
        );
        refs.extend(
            obsidian
                .captures_iter(line)
                .filter_map(|capture| capture.get(1).map(|value| value.as_str().trim().to_owned())),
        );
        for reference in refs {
            if is_external_reference(&reference) {
                continue;
            }
            let target = reference_target_path(&reference, &base, Path::new(&loaded.path));
            if target != Path::new(&loaded.path) {
                result.push(target);
            }
        }
    }
    result.sort();
    result.dedup();
    result
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn document_watch_targets(path: String) -> Result<Vec<String>, String> {
    let loaded = do_load_markdown(&path).map_err(|error| error.to_string())?;
    Ok(collect_document_watch_targets(&loaded))
}

#[tauri::command]
pub fn diagnose_document(path: String) -> Result<Vec<DiagnosticItem>, String> {
    let loaded = do_load_markdown(&path).map_err(|error| error.to_string())?;
    if loaded.kind != DocumentKind::Markdown {
        return Ok(Vec::new());
    }
    let source = loaded.content.replace("\r\n", "\n");
    let base = PathBuf::from(&loaded.base_dir);
    let mut diagnostics = Vec::new();
    let (heading_ids, heading_bases) = markdown_heading_ids(&source);
    let mut seen_heading_bases = std::collections::HashMap::new();
    let mut heading_fence = None;
    for (index, line) in source.lines().enumerate() {
        if heading_fence.is_some() {
            update_fence(&mut heading_fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut heading_fence, line);
            continue;
        }
        // Heading duplicate checks are based on the renderer's base slug,
        // before its deterministic -2/-3 suffix is applied.
        if let Some(title) = atx_heading_title(line) {
            let base_id = heading_base_id(title);
            let seen = seen_heading_bases.entry(base_id.clone()).or_insert(0);
            *seen += 1;
            if *seen > 1 && heading_bases.get(&base_id).copied().unwrap_or(0) > 1 {
                diagnostics.push(DiagnosticItem {
                    severity: "warning".into(),
                    kind: "見出しID".into(),
                    line: index + 1,
                    reference: base_id,
                    message: "見出しIDの基底値が重複しています。自動採番されたアンカーを使用してください。".into(),
                });
            }
        }
    }
    let mut fence = None;
    for (index, line) in source.lines().enumerate() {
        if fence.is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        if fence_marker(line).is_some() {
            update_fence(&mut fence, line);
            continue;
        }
        let mut references = markdown_references(line);
        references.extend(
            html_image_references(line)
                .into_iter()
                .map(|(reference, _)| (reference, true)),
        );
        for (reference, is_image) in references {
            if is_external_reference(&reference) {
                continue;
            }
            let (target, anchor) =
                diagnostic_reference_target(&reference, &base, Path::new(&loaded.path));
            if !target.exists() {
                diagnostics.push(DiagnosticItem {
                    severity: "error".into(),
                    kind: if is_image {
                        "画像".into()
                    } else {
                        "Markdownリンク".into()
                    },
                    line: index + 1,
                    reference: reference.clone(),
                    message: "参照先ファイルが存在しません。".into(),
                });
            } else if let Some(anchor) = anchor {
                let target_ids =
                    if target.canonicalize().ok().as_deref() == Some(Path::new(&loaded.path)) {
                        Some(heading_ids.clone())
                    } else if matches!(
                        crate::markdown::document_kind(&target),
                        Some(DocumentKind::Markdown)
                    ) {
                        do_load_markdown(&target.to_string_lossy())
                            .ok()
                            .map(|document| markdown_heading_ids(&document.content).0)
                    } else {
                        None
                    };
                if target_ids.is_some_and(|ids| {
                    !ids.contains(&anchor) && !ids.contains(&heading_base_id(&anchor))
                }) {
                    diagnostics.push(DiagnosticItem {
                        severity: "error".into(),
                        kind: "見出しアンカー".into(),
                        line: index + 1,
                        reference: reference.clone(),
                        message: "参照先見出しが存在しません。".into(),
                    });
                }
            }
        }
        let markdown_alt_empty = regex::Regex::new(r#"!\[([^\]]*)\]\("#)
            .unwrap()
            .captures_iter(line)
            .any(|capture| {
                capture
                    .get(1)
                    .is_some_and(|value| value.as_str().trim().is_empty())
            });
        let html_alt_empty = html_image_references(line)
            .into_iter()
            .any(|(_, alt_empty)| alt_empty);
        if markdown_alt_empty || html_alt_empty {
            diagnostics.push(DiagnosticItem {
                severity: "warning".into(),
                kind: "画像alt".into(),
                line: index + 1,
                reference: line.trim().into(),
                message: "画像のaltテキストが空です。".into(),
            });
        }
    }
    Ok(diagnostics)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standalone_diagrams_are_not_parsed_as_markdown_diagnostics() {
        let directory = tempfile::tempdir().unwrap();
        let mermaid = directory.path().join("broken-links.mermaid");
        let svg = directory.path().join("broken-links.svg");
        std::fs::write(&mermaid, "A --> B\n[missing](missing.md)").unwrap();
        std::fs::write(&svg, r#"<svg><text>[missing](missing.md)</text></svg>"#).unwrap();

        assert!(diagnose_document(mermaid.to_string_lossy().into_owned())
            .unwrap()
            .is_empty());
        assert!(diagnose_document(svg.to_string_lossy().into_owned())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn diagnostics_decode_references_and_check_external_anchors_and_html_alt() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("参照先.md");
        std::fs::write(&target, "# 見出し\n").unwrap();
        let source = directory.path().join("main.md");
        std::fs::write(&source, "# 重複\n# 重複\n[ok](%E5%8F%82%E7%85%A7%E5%85%88.md#%E8%A6%8B%E5%87%BA%E3%81%97)\n[bad](%E5%8F%82%E7%85%A7%E5%85%88.md#missing)\n<img src=\"missing.png\" alt=\"\">\n```md\n[ignored](missing.md)\n````\n").unwrap();
        let items = diagnose_document(source.to_string_lossy().into_owned()).unwrap();
        assert!(items.iter().any(|item| item.kind == "見出しID"));
        assert!(items
            .iter()
            .any(|item| item.kind == "見出しアンカー" && item.reference.contains("missing")));
        assert!(items
            .iter()
            .any(|item| item.kind == "画像" && item.reference == "missing.png"));
        assert!(items.iter().any(|item| item.kind == "画像alt"));
        assert!(!items.iter().any(|item| item.reference.contains("ignored")));
    }

    #[test]
    fn reference_target_decodes_path_and_fragment_without_decoding_encoded_hashes() {
        let base = Path::new("C:/docs");
        let document = base.join("main.md");
        let (target, anchor) = diagnostic_reference_target(
            "%E5%8F%82%E7%85%A7%232.md#%E8%A6%8B%E5%87%BA%E3%81%97%202",
            base,
            &document,
        );

        assert_eq!(target, base.join("参照#2.md"));
        assert_eq!(anchor.as_deref(), Some("見出し 2"));
    }

    #[test]
    fn diagnostics_handle_indented_headings_and_do_not_parse_fenced_content() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("headings.md");
        std::fs::write(
            &source,
            "  # Same\n# Same\n~~~md\n# Same\n[missing](missing.md)\n~~~\n",
        )
        .unwrap();

        let items = diagnose_document(source.to_string_lossy().into_owned()).unwrap();
        let duplicate_lines: Vec<_> = items
            .iter()
            .filter(|item| item.kind == "見出しID")
            .map(|item| item.line)
            .collect();
        assert_eq!(duplicate_lines, vec![2]);
        assert!(!items.iter().any(|item| item.reference.contains("missing")));
    }

    #[test]
    fn diagnostics_check_each_html_image_and_keep_markdown_link_kind() {
        let directory = tempfile::tempdir().unwrap();
        let image = directory.path().join("present.png");
        std::fs::write(&image, b"image").unwrap();
        let source = directory.path().join("images.md");
        std::fs::write(
            &source,
            "[missing](missing.md) ![missing alt](present.png)\n<img alt=\"ok\" src=\"present.png\"><img src=\"present.png\" alt=\"\"><img src=missing.png>\n",
        )
        .unwrap();

        let items = diagnose_document(source.to_string_lossy().into_owned()).unwrap();
        assert!(items.iter().any(|item| item.kind == "Markdownリンク"));
        assert!(items
            .iter()
            .any(|item| item.kind == "画像" && item.reference == "missing.png"));
        assert!(items
            .iter()
            .any(|item| item.kind == "画像alt" && item.line == 2));
        assert_eq!(
            items.iter().filter(|item| item.kind == "画像alt").count(),
            1
        );
    }

    #[test]
    fn document_watch_targets_return_decoded_local_references_and_skip_external_and_fences() {
        let directory = tempfile::tempdir().unwrap();
        let referenced = directory.path().join("参照先.md");
        std::fs::write(&referenced, "# target").unwrap();
        let image = directory.path().join("image.png");
        std::fs::write(&image, b"image").unwrap();
        let source = directory.path().join("watch.md");
        std::fs::write(
            &source,
            "[doc](%E5%8F%82%E7%85%A7%E5%85%88.md)\n<img src=image.png alt=\"image\">\n[web](https://example.com/ref.md)\n```\n[ignored](ignored.md)\n```\n",
        )
        .unwrap();

        let targets = document_watch_targets(source.to_string_lossy().into_owned()).unwrap();
        let source = std::fs::canonicalize(source)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let referenced = std::fs::canonicalize(referenced)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let image = std::fs::canonicalize(image)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut expected = vec![source, image, referenced];
        expected.sort();
        assert_eq!(targets, expected);
        assert!(!targets.iter().any(|target| target.contains("ignored")));
    }

}
