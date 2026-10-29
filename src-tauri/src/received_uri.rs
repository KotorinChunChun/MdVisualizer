//! 直前の受信URL。自動永続化・ログ出力をせず、明示した表示／コピーだけに使う。
use crate::sharepoint::{canonical_sharepoint_uri, is_spmd_uri};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedUri {
    pub value: String,
    pub received_at: String,
    pub origin: String,
    pub error: Option<String>,
}
#[derive(Default)]
pub struct ReceivedUriStore(Mutex<Option<ReceivedUri>>);
impl ReceivedUriStore {
    pub fn record(&self, value: &str, origin: &str) -> Option<ReceivedUri> {
        let item = ReceivedUri {
            value: value.chars().take(32768).collect(),
            received_at: chrono::Utc::now().to_rfc3339(), origin: origin.into(),
            error: canonical_sharepoint_uri(value.to_string()).err(),
        };
        let mut latest = self.0.lock().ok()?;
        *latest = Some(item.clone()); Some(item)
    }
    pub fn latest(&self) -> Option<ReceivedUri> { self.0.lock().ok()?.clone() }
    pub fn arguments(&self, values: &[String], origin: &str) -> Option<ReceivedUri> {
        values.iter().rev().find(|value| is_spmd_uri(value) || value.get(..6).is_some_and(|prefix| prefix.eq_ignore_ascii_case("https:")))
            .and_then(|value| self.record(value, origin))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_the_received_value_and_validation_reason_only_in_memory() {
        let store = ReceivedUriStore::default(); assert!(store.latest().is_none());
        let raw = "spmd://contoso.sharepoint.com/Wiki/readme.md?token=private";
        let entry = store.record(raw,"起動引数").unwrap();
        assert_eq!(entry.value,raw); assert!(entry.error.unwrap().contains("クエリ"));
        assert!(!store.latest().unwrap().received_at.is_empty());
        assert!(ReceivedUriStore::default().latest().is_none());
    }
    #[test]
    fn captures_the_last_url_without_replacing_it_with_local_paths() {
        let store = ReceivedUriStore::default();
        let first = "https://contoso.sharepoint.com/Wiki/日本語.md";
        store.arguments(&[first.into(),"C:/local.md".into()],"起動引数");
        assert_eq!(store.latest().unwrap().value,first);
        store.arguments(&["C:/second.md".into()],"再起動引数");
        assert_eq!(store.latest().unwrap().value,first);
        assert!(store.latest().unwrap().error.is_none());
        store.record("spmd:","再起動引数"); assert_eq!(store.latest().unwrap().value,"spmd:");
    }
}
