use percent_encoding::percent_decode_str;
use serde::Serialize;
use thiserror::Error;
use url::Url;

pub const SPMD_SCHEME: &str = "spmd";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpmdUri {
    pub canonical_uri: String,
    pub tenant_host: String,
    pub server_relative_path: String,
    pub site_path: String,
    pub filename: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SpmdUriError {
    #[error("spmd URIの形式が正しくありません。")]
    Invalid,
    #[error("spmd URIのホストはSharePoint Online（*.sharepoint.com）である必要があります。")]
    InvalidHost,
    #[error("spmd URIにユーザー情報、ポート、クエリ、フラグメントは指定できません。")]
    UnsupportedComponent,
    #[error("spmd URIのパスは/sites/または/teams/から始めてください。")]
    InvalidSitePath,
    #[error("spmd URIのパスに安全でない文字または区切りが含まれています。")]
    UnsafePath,
    #[error("spmd URIで開けるのは.mdまたは.markdownファイルだけです。")]
    UnsupportedDocument,
}

pub fn is_spmd_uri(value: &str) -> bool {
    value
        .get(..SPMD_SCHEME.len() + 1)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("spmd:"))
}

pub fn parse_spmd_uri(value: &str) -> Result<SpmdUri, SpmdUriError> {
    let parsed = Url::parse(value).map_err(|_| SpmdUriError::Invalid)?;
    if parsed.scheme() != SPMD_SCHEME || parsed.cannot_be_a_base() {
        return Err(SpmdUriError::Invalid);
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(SpmdUriError::UnsupportedComponent);
    }

    let tenant_host = parsed
        .host_str()
        .filter(|host| {
            let host = host.to_ascii_lowercase();
            host.ends_with(".sharepoint.com") && host.len() > ".sharepoint.com".len()
        })
        .ok_or(SpmdUriError::InvalidHost)?
        .to_ascii_lowercase();

    let encoded_segments = parsed
        .path_segments()
        .ok_or(SpmdUriError::Invalid)?
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let decoded_segments = encoded_segments
        .iter()
        .map(|segment| decode_safe_segment(segment))
        .collect::<Result<Vec<_>, _>>()?;

    if decoded_segments.len() < 4
        || !matches!(decoded_segments.first().map(String::as_str), Some("sites" | "teams"))
        || decoded_segments[1].is_empty()
    {
        return Err(SpmdUriError::InvalidSitePath);
    }

    let filename = decoded_segments.last().cloned().ok_or(SpmdUriError::InvalidSitePath)?;
    if !filename.to_ascii_lowercase().ends_with(".md")
        && !filename.to_ascii_lowercase().ends_with(".markdown")
    {
        return Err(SpmdUriError::UnsupportedDocument);
    }

    Ok(SpmdUri {
        canonical_uri: format!("{SPMD_SCHEME}://{tenant_host}{}", parsed.path()),
        tenant_host,
        server_relative_path: format!("/{}", decoded_segments.join("/")),
        site_path: format!("/{}/{}", decoded_segments[0], decoded_segments[1]),
        filename,
    })
}

fn decode_safe_segment(value: &str) -> Result<String, SpmdUriError> {
    let decoded = percent_decode_str(value)
        .decode_utf8()
        .map_err(|_| SpmdUriError::UnsafePath)?
        .into_owned();
    let lower = decoded.to_ascii_lowercase();
    if decoded.is_empty()
        || decoded == "."
        || decoded == ".."
        || decoded.contains(['/', '\\'])
        || decoded.chars().any(char::is_control)
        || lower.contains("%2f")
        || lower.contains("%5c")
        || lower == "%2e"
        || lower == "%2e%2e"
    {
        return Err(SpmdUriError::UnsafePath);
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = "spmd://excelchunchun.sharepoint.com/sites/msteams_fcce9d/Shared%20Documents/md/README.md";

    #[test]
    fn parses_and_canonicalizes_the_documented_uri() {
        let parsed = parse_spmd_uri(EXAMPLE).unwrap();
        assert_eq!(parsed.canonical_uri, EXAMPLE);
        assert_eq!(parsed.tenant_host, "excelchunchun.sharepoint.com");
        assert_eq!(parsed.site_path, "/sites/msteams_fcce9d");
        assert_eq!(parsed.server_relative_path, "/sites/msteams_fcce9d/Shared Documents/md/README.md");
        assert_eq!(parsed.filename, "README.md");
    }

    #[test]
    fn accepts_teams_and_utf8_percent_encoded_paths() {
        let parsed = parse_spmd_uri(
            "SPMD://CONTOSO.sharepoint.com/teams/docs/%E5%85%B1%E6%9C%89/%E6%89%8B%E9%A0%86.markdown",
        )
        .unwrap();
        assert_eq!(parsed.tenant_host, "contoso.sharepoint.com");
        assert_eq!(parsed.server_relative_path, "/teams/docs/共有/手順.markdown");
    }

    #[test]
    fn rejects_untrusted_hosts_and_unsupported_components() {
        assert_eq!(
            parse_spmd_uri("spmd://example.com/sites/a/docs/readme.md"),
            Err(SpmdUriError::InvalidHost)
        );
        assert_eq!(
            parse_spmd_uri("spmd://user@contoso.sharepoint.com/sites/a/docs/readme.md"),
            Err(SpmdUriError::UnsupportedComponent)
        );
        assert_eq!(
            parse_spmd_uri("spmd://contoso.sharepoint.com/sites/a/docs/readme.md?token=secret"),
            Err(SpmdUriError::UnsupportedComponent)
        );
    }

    #[test]
    fn rejects_unsafe_or_non_markdown_paths() {
        for uri in [
            "spmd://contoso.sharepoint.com/personal/a/docs/readme.md",
            "spmd://contoso.sharepoint.com/sites/a/docs/image.png",
            "spmd://contoso.sharepoint.com/sites/a/docs/%252fsecret.md",
            "spmd://contoso.sharepoint.com/sites/a/docs/%5Csecret.md",
        ] {
            assert!(parse_spmd_uri(uri).is_err(), "{uri}");
        }
    }
}
