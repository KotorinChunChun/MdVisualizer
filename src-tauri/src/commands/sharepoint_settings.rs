//! SharePoint接続設定の表示とURI検証。
use crate::sharepoint::{parse_spmd_uri, SharePointAuthConfig};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePointConnectionInfo {
    client_id: String,
    tenant: String,
    direct_protocol_registration: bool,
}

#[tauri::command]
pub fn sharepoint_connection_info(app: AppHandle) -> Result<SharePointConnectionInfo, String> {
    let config = SharePointAuthConfig::embedded();
    Ok(SharePointConnectionInfo {
        client_id: config.client_id,
        tenant: config.tenant,
        direct_protocol_registration: app.deep_link().is_registered("spmd").map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub fn validate_sharepoint_uri(value: String) -> Result<String, String> {
    let value = value.trim();
    let uri = if value.get(..8).is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://")) {
        format!("spmd://{}", &value[8..])
    } else {
        value.to_string()
    };
    parse_spmd_uri(&uri).map(|parsed| parsed.canonical_uri).map_err(|error| error.to_string())
}

#[cfg(test)]
mod sharepoint_settings_tests {
    use super::validate_sharepoint_uri;

    #[test]
    fn accepts_direct_https_and_spmd_without_network() {
        let expected = "spmd://contoso.sharepoint.com/sites/docs/Shared%20Documents/readme.md";
        assert_eq!(validate_sharepoint_uri(format!("  {}  ", expected)), Ok(expected.into()));
        assert_eq!(validate_sharepoint_uri(expected.replacen("spmd:", "https:", 1)), Ok(expected.into()));
        assert!(validate_sharepoint_uri(expected.to_ascii_uppercase()).is_ok());
    }

    #[test]
    fn rejects_sharing_links_credentials_and_other_hosts_without_echoing_input() {
        for value in [
            "https://evil.example/sites/docs/library/a.md",
            "https://user:secret@contoso.sharepoint.com/sites/docs/library/a.md",
            "https://contoso.sharepoint.com/sites/docs/library/a.md?token=secret",
            "https://contoso.sharepoint.com/sites/docs/library/a.md#fragment",
            "https://contoso.sharepoint.com/:u:/r/sites/docs/library/a.md",
            "https://contoso.sharepoint.com/sites/docs/library/Forms/AllItems.aspx",
            "https://contoso.sharepoint.com/sites/docs/library/%252fsecret.md",
            "http://contoso.sharepoint.com/sites/docs/library/a.md",
        ] {
            let error = validate_sharepoint_uri(value.into()).unwrap_err();
            assert!(!error.contains("secret"));
            assert!(!error.contains(value));
        }
    }
}

