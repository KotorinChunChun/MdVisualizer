use crate::markdown::{
    content_revision, decode_markdown, DocumentKind, DocumentSourceKind, MarkdownLoadResult,
};
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;
use url::Url;

pub const SPMD_SCHEME: &str = "spmd";
const GRAPH_ROOT: &str = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE: &str = "offline_access https://graph.microsoft.com/Sites.Read.All";
const SHAREPOINT_CLIENT_ID: &str = "f0fe07a2-a716-44de-bf0e-55d5b468d225";
const SHAREPOINT_TENANT: &str = "organizations";
const MAX_MARKDOWN_BYTES: usize = 10 * 1024 * 1024;

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
        || !matches!(
            decoded_segments.first().map(String::as_str),
            Some("sites" | "teams")
        )
        || decoded_segments[1].is_empty()
    {
        return Err(SpmdUriError::InvalidSitePath);
    }

    let filename = decoded_segments
        .last()
        .cloned()
        .ok_or(SpmdUriError::InvalidSitePath)?;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharePointAuthConfig {
    pub client_id: String,
    pub tenant: String,
}

impl SharePointAuthConfig {
    pub fn embedded() -> Self {
        Self {
            client_id: SHAREPOINT_CLIENT_ID.into(),
            tenant: SHAREPOINT_TENANT.into(),
        }
    }

    fn cache_key(&self) -> String {
        format!("{}:{}", self.tenant, self.client_id)
    }
}

#[derive(Debug, Error)]
pub enum SharePointError {
    #[error("Microsoftへのサインインを完了できませんでした: {0}")]
    Authentication(String),
    #[error("SharePoint文書を取得できませんでした: {0}")]
    Graph(String),
    #[error("SharePoint文書が大きすぎます（上限10 MB）。")]
    DocumentTooLarge,
    #[error("SharePoint文書の場所をドキュメントライブラリとして解決できませんでした。")]
    DriveNotFound,
    #[error(transparent)]
    Uri(#[from] SpmdUriError),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodePrompt {
    pub user_code: String,
    pub verification_uri: String,
    pub message: String,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: Option<u64>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    error: String,
    error_description: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedToken {
    access_token: String,
    expires_at: Instant,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SiteResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct DrivesResponse {
    value: Vec<DriveResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveResponse {
    id: String,
    web_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveItemResponse {
    id: String,
    name: String,
    size: u64,
    last_modified_date_time: String,
    e_tag: Option<String>,
    web_url: String,
}

pub struct SharePointClient {
    http: Client,
    tokens: Mutex<HashMap<String, CachedToken>>,
    auth_gate: AsyncMutex<()>,
}

impl SharePointClient {
    pub fn new() -> Result<Self, SharePointError> {
        let http = Client::builder()
            .user_agent(concat!("MarkdownViewer/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|error| SharePointError::Graph(error.to_string()))?;
        Ok(Self {
            http,
            tokens: Mutex::new(HashMap::new()),
            auth_gate: AsyncMutex::new(()),
        })
    }

    pub async fn load_markdown<F>(
        &self,
        source: &SpmdUri,
        config: &SharePointAuthConfig,
        show_prompt: F,
    ) -> Result<MarkdownLoadResult, SharePointError>
    where
        F: FnOnce(DeviceCodePrompt) -> Result<(), SharePointError>,
    {
        let token = self.access_token(config, show_prompt).await?;
        let site_url = format!(
            "{GRAPH_ROOT}/sites/{}:{}",
            source.tenant_host,
            encode_graph_path(&source.site_path)
        );
        let site: SiteResponse = self.graph_json(&site_url, &token).await?;
        let drives_url = format!("{GRAPH_ROOT}/sites/{}/drives", encode_segment(&site.id));
        let drives: DrivesResponse = self.graph_json(&drives_url, &token).await?;
        let (drive, item_path) = select_drive(&drives.value, source)?;
        let item_url = format!(
            "{GRAPH_ROOT}/drives/{}/root:/{}",
            encode_segment(&drive.id),
            encode_graph_path(&item_path).trim_start_matches('/')
        );
        let item: DriveItemResponse = self.graph_json(&item_url, &token).await?;
        let item_name = item.name.to_ascii_lowercase();
        if !item_name.ends_with(".md") && !item_name.ends_with(".markdown") {
            return Err(SpmdUriError::UnsupportedDocument.into());
        }
        if item.size as usize > MAX_MARKDOWN_BYTES {
            return Err(SharePointError::DocumentTooLarge);
        }
        let content_url = format!(
            "{GRAPH_ROOT}/drives/{}/items/{}/content",
            encode_segment(&drive.id),
            encode_segment(&item.id)
        );
        let bytes = self.graph_bytes(&content_url, &token).await?;
        let revision = item
            .e_tag
            .clone()
            .unwrap_or_else(|| content_revision(&bytes));
        let (content, encoding) = decode_markdown(&bytes);
        let base_dir = source
            .canonical_uri
            .rsplit_once('/')
            .map(|(parent, _)| parent.to_string())
            .unwrap_or_else(|| source.canonical_uri.clone());
        Ok(MarkdownLoadResult {
            path: source.canonical_uri.clone(),
            kind: DocumentKind::Markdown,
            content,
            base_dir,
            image_paths: Vec::new(),
            encoding,
            size_bytes: item.size,
            modified_at: format_modified_at(&item.last_modified_date_time),
            revision,
            source: DocumentSourceKind::SharePoint,
            web_url: Some(item.web_url),
            etag: item.e_tag,
        })
    }

    async fn access_token<F>(
        &self,
        config: &SharePointAuthConfig,
        show_prompt: F,
    ) -> Result<String, SharePointError>
    where
        F: FnOnce(DeviceCodePrompt) -> Result<(), SharePointError>,
    {
        let key = config.cache_key();
        if let Some(access_token) = self.cached_access_token(&key) {
            return Ok(access_token);
        }
        let _gate = self.auth_gate.lock().await;
        if let Some(access_token) = self.cached_access_token(&key) {
            return Ok(access_token);
        }
        if let Some(refresh_token) = self.cached_refresh_token(&key) {
            if let Ok(token) = self.refresh_access_token(config, &refresh_token).await {
                let access_token = token.access_token.clone();
                self.store_token(key.clone(), token);
                return Ok(access_token);
            }
            self.tokens
                .lock()
                .expect("SharePoint token cache poisoned")
                .remove(&key);
        }

        let device = self.request_device_code(config).await?;
        show_prompt(DeviceCodePrompt {
            user_code: device.user_code.clone(),
            verification_uri: device.verification_uri.clone(),
            message: device.message.clone().unwrap_or_else(|| {
                format!(
                    "{} を開き、コード {} を入力してください。",
                    device.verification_uri, device.user_code
                )
            }),
            expires_in: device.expires_in,
        })?;
        let token = self.poll_device_code(config, &device).await?;
        let access_token = token.access_token.clone();
        self.store_token(key, token);
        Ok(access_token)
    }

    fn cached_access_token(&self, key: &str) -> Option<String> {
        self.tokens
            .lock()
            .expect("SharePoint token cache poisoned")
            .get(key)
            .filter(|token| token.expires_at > Instant::now() + Duration::from_secs(30))
            .map(|token| token.access_token.clone())
    }

    fn cached_refresh_token(&self, key: &str) -> Option<String> {
        self.tokens
            .lock()
            .expect("SharePoint token cache poisoned")
            .get(key)
            .and_then(|token| token.refresh_token.clone())
    }

    fn store_token(&self, key: String, token: TokenResponse) {
        self.tokens
            .lock()
            .expect("SharePoint token cache poisoned")
            .insert(
                key,
                CachedToken {
                    access_token: token.access_token,
                    expires_at: Instant::now() + Duration::from_secs(token.expires_in.max(60)),
                    refresh_token: token.refresh_token,
                },
            );
    }

    async fn request_device_code(
        &self,
        config: &SharePointAuthConfig,
    ) -> Result<DeviceCodeResponse, SharePointError> {
        let url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/devicecode",
            config.tenant
        );
        let response = self
            .http
            .post(url)
            .form(&[
                ("client_id", config.client_id.as_str()),
                ("scope", GRAPH_SCOPE),
            ])
            .send()
            .await
            .map_err(authentication_transport_error)?;
        parse_oauth_success(response).await
    }

    async fn poll_device_code(
        &self,
        config: &SharePointAuthConfig,
        device: &DeviceCodeResponse,
    ) -> Result<TokenResponse, SharePointError> {
        let url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            config.tenant
        );
        let deadline = Instant::now() + Duration::from_secs(device.expires_in);
        let mut interval = Duration::from_secs(device.interval.unwrap_or(5).max(1));
        loop {
            tokio::time::sleep(interval).await;
            if Instant::now() >= deadline {
                return Err(SharePointError::Authentication(
                    "サインインコードの有効期限が切れました。".into(),
                ));
            }
            let response = self
                .http
                .post(&url)
                .form(&[
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                    ("client_id", config.client_id.as_str()),
                    ("device_code", device.device_code.as_str()),
                ])
                .send()
                .await
                .map_err(authentication_transport_error)?;
            if response.status().is_success() {
                return response
                    .json::<TokenResponse>()
                    .await
                    .map_err(|error| SharePointError::Authentication(error.to_string()));
            }
            let error = response
                .json::<OAuthErrorResponse>()
                .await
                .map_err(|error| SharePointError::Authentication(error.to_string()))?;
            match error.error.as_str() {
                "authorization_pending" => continue,
                "slow_down" => {
                    interval += Duration::from_secs(5);
                    continue;
                }
                "authorization_declined" => {
                    return Err(SharePointError::Authentication(
                        "サインインがキャンセルされました。".into(),
                    ));
                }
                "expired_token" | "bad_verification_code" => {
                    return Err(SharePointError::Authentication(
                        "サインインコードの有効期限が切れました。".into(),
                    ));
                }
                _ => return Err(oauth_error(error)),
            }
        }
    }

    async fn refresh_access_token(
        &self,
        config: &SharePointAuthConfig,
        refresh_token: &str,
    ) -> Result<TokenResponse, SharePointError> {
        let url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            config.tenant
        );
        let response = self
            .http
            .post(url)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", config.client_id.as_str()),
                ("refresh_token", refresh_token),
                ("scope", GRAPH_SCOPE),
            ])
            .send()
            .await
            .map_err(authentication_transport_error)?;
        parse_oauth_success(response).await
    }

    async fn graph_json<T: for<'de> Deserialize<'de>>(
        &self,
        url: &str,
        access_token: &str,
    ) -> Result<T, SharePointError> {
        let response = self
            .http
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|error| SharePointError::Graph(error.to_string()))?;
        let response = ensure_graph_success(response).await?;
        response
            .json::<T>()
            .await
            .map_err(|error| SharePointError::Graph(error.to_string()))
    }

    async fn graph_bytes(&self, url: &str, access_token: &str) -> Result<Vec<u8>, SharePointError> {
        let response = self
            .http
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|error| SharePointError::Graph(error.to_string()))?;
        let mut response = ensure_graph_success(response).await?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_MARKDOWN_BYTES as u64)
        {
            return Err(SharePointError::DocumentTooLarge);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| SharePointError::Graph(error.to_string()))?
        {
            if bytes.len() + chunk.len() > MAX_MARKDOWN_BYTES {
                return Err(SharePointError::DocumentTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
}

fn authentication_transport_error(error: reqwest::Error) -> SharePointError {
    SharePointError::Authentication(error.to_string())
}

async fn parse_oauth_success<T: for<'de> Deserialize<'de>>(
    response: Response,
) -> Result<T, SharePointError> {
    if response.status().is_success() {
        return response
            .json::<T>()
            .await
            .map_err(|error| SharePointError::Authentication(error.to_string()));
    }
    let error = response
        .json::<OAuthErrorResponse>()
        .await
        .map_err(|error| SharePointError::Authentication(error.to_string()))?;
    Err(oauth_error(error))
}

fn oauth_error(error: OAuthErrorResponse) -> SharePointError {
    SharePointError::Authentication(
        error
            .error_description
            .unwrap_or(error.error)
            .chars()
            .take(1000)
            .collect(),
    )
}

async fn ensure_graph_success(response: Response) -> Result<Response, SharePointError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    let detail = detail.chars().take(2000).collect::<String>();
    let reason = match status {
        StatusCode::UNAUTHORIZED => "Microsoftへのサインインが無効です。".to_string(),
        StatusCode::FORBIDDEN => "このSharePoint文書を読む権限がありません。".to_string(),
        StatusCode::NOT_FOUND => {
            "SharePointサイト、ライブラリ、または文書が見つかりません。".to_string()
        }
        _ => format!("Microsoft GraphがHTTP {status}を返しました。 {detail}"),
    };
    Err(SharePointError::Graph(reason))
}

fn encode_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn encode_graph_path(value: &str) -> String {
    let path = value
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/");
    format!("/{path}")
}

fn select_drive<'a>(
    drives: &'a [DriveResponse],
    source: &SpmdUri,
) -> Result<(&'a DriveResponse, String), SharePointError> {
    let document_segments = path_segments(&source.server_relative_path);
    drives
        .iter()
        .filter_map(|drive| {
            let url = Url::parse(&drive.web_url).ok()?;
            if !url
                .host_str()
                .is_some_and(|host| host.eq_ignore_ascii_case(&source.tenant_host))
            {
                return None;
            }
            let drive_segments = decoded_url_path_segments(&url).ok()?;
            if drive_segments.len() >= document_segments.len()
                || !drive_segments
                    .iter()
                    .zip(document_segments.iter())
                    .all(|(left, right)| left == right || left.eq_ignore_ascii_case(right))
            {
                return None;
            }
            let item = document_segments[drive_segments.len()..].join("/");
            Some((drive, item, drive_segments.len()))
        })
        .max_by_key(|(_, _, matched)| *matched)
        .map(|(drive, item, _)| (drive, item))
        .ok_or(SharePointError::DriveNotFound)
}

fn path_segments(path: &str) -> Vec<String> {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect()
}

fn decoded_url_path_segments(url: &Url) -> Result<Vec<String>, SpmdUriError> {
    url.path_segments()
        .ok_or(SpmdUriError::Invalid)?
        .filter(|segment| !segment.is_empty())
        .map(decode_safe_segment)
        .collect()
}

fn format_modified_at(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str =
        "spmd://excelchunchun.sharepoint.com/sites/msteams_fcce9d/Shared%20Documents/md/README.md";

    #[test]
    fn parses_and_canonicalizes_the_documented_uri() {
        let parsed = parse_spmd_uri(EXAMPLE).unwrap();
        assert_eq!(parsed.canonical_uri, EXAMPLE);
        assert_eq!(parsed.tenant_host, "excelchunchun.sharepoint.com");
        assert_eq!(parsed.site_path, "/sites/msteams_fcce9d");
        assert_eq!(
            parsed.server_relative_path,
            "/sites/msteams_fcce9d/Shared Documents/md/README.md"
        );
        assert_eq!(parsed.filename, "README.md");
    }

    #[test]
    fn accepts_teams_and_utf8_percent_encoded_paths() {
        let parsed = parse_spmd_uri(
            "SPMD://CONTOSO.sharepoint.com/teams/docs/%E5%85%B1%E6%9C%89/%E6%89%8B%E9%A0%86.markdown",
        )
        .unwrap();
        assert_eq!(parsed.tenant_host, "contoso.sharepoint.com");
        assert_eq!(
            parsed.server_relative_path,
            "/teams/docs/共有/手順.markdown"
        );
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

    #[test]
    fn uses_the_embedded_multitenant_public_client() {
        assert_eq!(
            SharePointAuthConfig::embedded(),
            SharePointAuthConfig {
                client_id: "f0fe07a2-a716-44de-bf0e-55d5b468d225".into(),
                tenant: "organizations".into(),
            }
        );
    }

    #[test]
    fn selects_the_longest_matching_document_library() {
        let source = parse_spmd_uri(EXAMPLE).unwrap();
        let drives = vec![
            DriveResponse {
                id: "other".into(),
                web_url: "https://excelchunchun.sharepoint.com/sites/msteams_fcce9d/Other".into(),
            },
            DriveResponse {
                id: "documents".into(),
                web_url:
                    "https://excelchunchun.sharepoint.com/sites/msteams_fcce9d/Shared%20Documents"
                        .into(),
            },
        ];
        let (drive, item) = select_drive(&drives, &source).unwrap();
        assert_eq!(drive.id, "documents");
        assert_eq!(item, "md/README.md");
        assert_eq!(encode_graph_path(&item), "/md/README%2Emd");
    }
}
