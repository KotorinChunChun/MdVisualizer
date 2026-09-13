//! Codex会話のローカル保存。通信ログとは分離し、明示的に保存した会話だけを扱う。
use crate::file_lock::{atomic_write, with_lock};
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SESSIONS_FILENAME: &str = "codex-sessions.json";
const DEFAULT_RETENTION_DAYS: u16 = 30;
const MAX_RETENTION_DAYS: u16 = 3650;
const MAX_SESSIONS: usize = 500;
const MAX_MESSAGES: usize = 500;
const MAX_ATTACHMENTS: usize = 100;
const MAX_TEXT_LENGTH: usize = 200_000;
const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_SESSION_BYTES: usize = 20 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionStore {
    pub retention_days: u16,
    pub sessions: Vec<CodexConversation>,
    /// 削除後に到着した遅延自動保存で会話を復活させないためのID一覧。
    #[serde(default, skip_serializing_if = "HashSet::is_empty")]
    pub deleted_session_ids: HashSet<String>,
}

impl Default for CodexSessionStore {
    fn default() -> Self {
        Self {
            retention_days: DEFAULT_RETENTION_DAYS,
            sessions: Vec::new(),
            deleted_session_ids: HashSet::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConversation {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_path: Option<String>,
    #[serde(default)]
    pub messages: Vec<CodexConversationMessage>,
    #[serde(default)]
    pub attachments: Vec<CodexConversationAttachment>,
    pub draft: CodexConversationDraft,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_text_target_number: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConversationMessage {
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub attachment_labels: HashMap<String, String>,
    pub timestamp: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConversationAttachment {
    pub id: String,
    pub label: String,
    pub base64: String,
    pub mime: String,
    pub name: String,
    pub added_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConversationDraft {
    pub instruction: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_snapshot: Option<CodexDraftSnapshot>,
    pub edit_mode: String,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_label: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_targets: Vec<CodexConversationTextTarget>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConversationTextTarget {
    pub id: String,
    pub label: String,
    pub snapshot: CodexDraftSnapshot,
    pub added_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDraftSnapshot {
    pub document_id: String,
    pub content: String,
    pub from: usize,
    pub to: usize,
}

fn sessions_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(SESSIONS_FILENAME))
        .map_err(|error| format!("AI会話履歴の保存先を取得できません: {error}"))
}

/// 通信ログも会話履歴と同じ保持期間に従う。未送信の下書きは通信ログからは復元しない。
pub fn codex_session_retention_days(app: &AppHandle) -> Result<u16, String> {
    let path = sessions_path(app)?;
    with_lock(&path, || {
        let store = load_from(&path).map_err(crate::errors::AppError::IoError)?;
        Ok(if store.retention_days > MAX_RETENTION_DAYS {
            DEFAULT_RETENTION_DAYS
        } else {
            store.retention_days
        })
    })
    .map_err(|error| error.to_string())
}

fn load_from(path: &Path) -> Result<CodexSessionStore, String> {
    if !path.exists() {
        return Ok(CodexSessionStore::default());
    }
    let bytes =
        std::fs::read(path).map_err(|error| format!("AI会話履歴を読み込めません: {error}"))?;
    if bytes.len() > MAX_SESSION_BYTES {
        return Err("AI会話履歴のサイズが上限を超えています。".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "AI会話履歴の形式が不正です。".into())
}

fn persist(path: &Path, store: &CodexSessionStore) -> Result<(), String> {
    let content = serde_json::to_vec(store)
        .map_err(|_| "AI会話履歴を保存用に変換できません。".to_string())?;
    if content.len() > MAX_SESSION_BYTES {
        return Err("AI会話履歴のサイズが上限を超えています。画像を減らしてください。".into());
    }
    atomic_write(path, &content).map_err(|error| error.to_string())
}

fn valid_id(value: &str) -> bool {
    (1..=100).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_text(value: &str, maximum: usize) -> bool {
    value.len() <= maximum && !value.contains('\0')
}

fn valid_document_id(value: &str) -> bool {
    // フロントエンドのタブID:世代。保存先のパスには使用しない。
    (1..=200).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
}

fn valid_path(value: &str) -> bool {
    // 会話履歴は文書を開かない。NUL・制御文字・過大な経路だけを拒否し、URIとWindows経路をそのまま識別子として保つ。
    value.len() <= 32_768
        && !value.chars().any(|character| {
            character == '\0'
                || (character.is_control()
                    && character != '\n'
                    && character != '\r'
                    && character != '\t')
        })
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc))
        .map_err(|_| "AI会話履歴の日時が不正です。".into())
}

fn validate_conversation(conversation: &CodexConversation) -> Result<(), String> {
    if !valid_id(&conversation.id) {
        return Err("会話IDが不正です。".into());
    }
    if !valid_text(&conversation.title, 500)
        || !conversation
            .document_id
            .as_deref()
            .map_or(true, valid_document_id)
        || !conversation
            .document_path
            .as_deref()
            .map_or(true, valid_path)
    {
        return Err("会話の文書情報が不正です。".into());
    }
    if conversation.messages.len() > MAX_MESSAGES
        || conversation.attachments.len() > MAX_ATTACHMENTS
        || !valid_text(&conversation.draft.instruction, MAX_TEXT_LENGTH)
        || !matches!(
            conversation.draft.edit_mode.as_str(),
            "selection" | "document" | "question"
        )
    {
        return Err("会話履歴の件数または下書きが上限を超えています。".into());
    }
    let created = parse_time(&conversation.created_at)?;
    let updated = parse_time(&conversation.updated_at)?;
    if updated < created {
        return Err("会話履歴の更新日時が不正です。".into());
    }
    if let Some(last) = &conversation.last_message_at {
        if parse_time(last)? < created {
            return Err("会話履歴の最終会話日時が不正です。".into());
        }
    }
    if conversation
        .context_tokens
        .is_some_and(|tokens| tokens > 20_000_000)
    {
        return Err("会話の直近入力トークン数が不正です。".into());
    }
    if conversation
        .next_text_target_number
        .is_some_and(|number| number == 0)
    {
        return Err("会話の次回対象本文番号が不正です。".into());
    }
    if !conversation
        .draft
        .target_label
        .as_deref()
        .map_or(true, |value| valid_text(value, 200))
    {
        return Err("下書きの対象本文名が不正です。".into());
    }
    let attachment_ids = conversation
        .attachments
        .iter()
        .map(|attachment| {
            if !valid_id(&attachment.id)
                || !valid_text(&attachment.label, 200)
                || !valid_text(&attachment.name, 500)
                || !attachment.mime.starts_with("image/")
                || attachment.mime.len() > 100
                || attachment.base64.len() > MAX_ATTACHMENT_BYTES.div_ceil(3) * 4
                || base64::engine::general_purpose::STANDARD
                    .decode(&attachment.base64)
                    .map_or(true, |bytes| bytes.len() > MAX_ATTACHMENT_BYTES)
            {
                return Err("添付画像が不正または大きすぎます。".into());
            }
            parse_time(&attachment.added_at)?;
            Ok(attachment.id.as_str())
        })
        .collect::<Result<HashSet<_>, String>>()?;
    if attachment_ids.len() != conversation.attachments.len() {
        return Err("添付画像IDが重複しています。".into());
    }
    for message in &conversation.messages {
        if !matches!(message.role.as_str(), "user" | "assistant")
            || !valid_text(&message.text, MAX_TEXT_LENGTH)
            || !message
                .attachment_ids
                .iter()
                .all(|id| attachment_ids.contains(id.as_str()))
            || !message.attachment_labels.iter().all(|(id, label)| attachment_ids.contains(id.as_str()) && valid_text(label, 200))
        {
            return Err("会話メッセージが不正です。".into());
        }
        parse_time(&message.timestamp)?;
    }
    if !conversation
        .draft
        .attachment_ids
        .iter()
        .all(|id| attachment_ids.contains(id.as_str()))
    {
        return Err("下書きの添付画像参照が不正です。".into());
    }
    if let Some(snapshot) = &conversation.draft.target_snapshot {
        if !valid_document_id(&snapshot.document_id)
            || !valid_text(&snapshot.content, MAX_TEXT_LENGTH)
            || snapshot.from > snapshot.to
            || snapshot.to > snapshot.content.len()
        {
            return Err("下書きの対象範囲が不正です。".into());
        }
    }
    if conversation.draft.text_targets.len() > MAX_ATTACHMENTS
        || conversation.draft.text_targets.iter().any(|target| {
            !valid_id(&target.id)
                || !valid_text(&target.label, 200)
                || !valid_document_id(&target.snapshot.document_id)
                || !valid_text(&target.snapshot.content, MAX_TEXT_LENGTH)
                || target.snapshot.from > target.snapshot.to
                || target.snapshot.to > target.snapshot.content.len()
                || parse_time(&target.added_at).is_err()
        })
        || conversation.draft.text_targets.iter().map(|target| &target.id).collect::<HashSet<_>>().len() != conversation.draft.text_targets.len()
    {
        return Err("下書きの対象本文が不正です。".into());
    }
    Ok(())
}

fn purge_expired(store: &mut CodexSessionStore, now: DateTime<Utc>) {
    if store.retention_days == 0 {
        store.sessions.clear();
        return;
    }
    let threshold = now - Duration::days(i64::from(store.retention_days));
    store.sessions.retain(|session| {
        parse_time(&session.updated_at).is_ok_and(|updated| updated >= threshold)
    });
    store
        .sessions
        .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    store.sessions.truncate(MAX_SESSIONS);
}

#[tauri::command]
pub fn load_codex_sessions(app: AppHandle) -> Result<CodexSessionStore, String> {
    let path = sessions_path(&app)?;
    with_lock(&path, || {
        let mut store = load_from(&path).map_err(crate::errors::AppError::IoError)?;
        if store.retention_days > MAX_RETENTION_DAYS {
            store.retention_days = DEFAULT_RETENTION_DAYS;
        }
        let before = store.sessions.len();
        purge_expired(&mut store, Utc::now());
        if before != store.sessions.len() {
            persist(&path, &store).map_err(crate::errors::AppError::IoError)?;
        }
        Ok(store)
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_codex_session(
    app: AppHandle,
    session: CodexConversation,
) -> Result<CodexSessionStore, String> {
    validate_conversation(&session)?;
    let path = sessions_path(&app)?;
    with_lock(&path, || {
        let mut store = load_from(&path).map_err(crate::errors::AppError::IoError)?;
        merge_session(&mut store, session, Utc::now());
        persist(&path, &store).map_err(crate::errors::AppError::IoError)?;
        Ok(store)
    })
    .map_err(|error| error.to_string())
}

fn merge_session(store: &mut CodexSessionStore, session: CodexConversation, now: DateTime<Utc>) {
    purge_expired(store, now);
    if store.retention_days == 0 {
        return;
    }
    // 削除済み会話には、削除前にキューへ積まれた保存も書き戻せない。
    if store.deleted_session_ids.contains(&session.id) {
        return;
    }
    // 遅延した自動保存で、別の画面が保存した新しい下書きを巻き戻さない。
    if store
        .sessions
        .iter()
        .any(|old| old.id == session.id && old.updated_at > session.updated_at)
    {
        return;
    }
    store.sessions.retain(|old| old.id != session.id);
    store.sessions.push(session);
    // 保持期間変更前にキューへ入った古い保存も、この時点の期限で捨てる。
    purge_expired(store, now);
    store.sessions.truncate(MAX_SESSIONS);
}

fn delete_session(store: &mut CodexSessionStore, session_id: &str, now: DateTime<Utc>) {
    purge_expired(store, now);
    // 添付は会話の内部データなので、会話を除去すれば同時に保存から除かれる。
    store.sessions.retain(|session| session.id != session_id);
    // IDだけを無期限に保持し、削除前にキューへ積まれた保存も書き戻せなくする。
    store.deleted_session_ids.insert(session_id.to_owned());
}

#[tauri::command]
pub fn delete_codex_session(
    app: AppHandle,
    session_id: String,
) -> Result<CodexSessionStore, String> {
    if !valid_id(&session_id) {
        return Err("会話IDが不正です。".into());
    }
    let path = sessions_path(&app)?;
    with_lock(&path, || {
        let mut store = load_from(&path).map_err(crate::errors::AppError::IoError)?;
        delete_session(&mut store, &session_id, Utc::now());
        persist(&path, &store).map_err(crate::errors::AppError::IoError)?;
        Ok(store)
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_codex_session_retention(
    app: AppHandle,
    retention_days: u16,
) -> Result<CodexSessionStore, String> {
    if retention_days > MAX_RETENTION_DAYS {
        return Err("会話履歴の保持日数は0〜3650日で指定してください。".into());
    }
    let path = sessions_path(&app)?;
    let store = with_lock(&path, || {
        let mut store = load_from(&path).map_err(crate::errors::AppError::IoError)?;
        store.retention_days = retention_days;
        purge_expired(&mut store, Utc::now());
        persist(&path, &store).map_err(crate::errors::AppError::IoError)?;
        Ok(store)
    })
    .map_err(|error| error.to_string())?;
    // 会話と別ファイルの旧通信ログも、設定を短縮したその場で期限切れを消す。
    crate::codex::purge_logs_for_retention(&app, retention_days)?;
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(updated_at: &str) -> CodexConversation {
        CodexConversation {
            id: "conversation-1".into(),
            title: "会話".into(),
            document_id: Some("document-1".into()),
            document_path: Some("C:\\docs\\note.md".into()),
            messages: vec![CodexConversationMessage {
                role: "user".into(),
                text: "質問".into(),
                attachment_ids: vec![],
                attachment_labels: HashMap::new(),
                timestamp: updated_at.into(),
            }],
            attachments: vec![],
            draft: CodexConversationDraft {
                instruction: "下書き".into(),
                target_snapshot: None,
                edit_mode: "question".into(),
                attachment_ids: vec![],
                target_label: Some("対象テキスト1".into()),
                text_targets: vec![],
            },
            created_at: updated_at.into(),
            updated_at: updated_at.into(),
            last_message_at: Some(updated_at.into()),
            context_tokens: None,
            next_text_target_number: Some(2),
        }
    }

    #[test]
    fn validates_attachment_references_and_path_boundaries() {
        let mut value = session("2026-09-13T00:00:00Z");
        value.messages[0].attachment_ids.push("missing".into());
        assert!(validate_conversation(&value).is_err());
        value.messages[0].attachment_ids.clear();
        value.document_path = Some("a\0b".into());
        assert!(validate_conversation(&value).is_err());
    }

    #[test]
    fn zero_days_erases_existing_conversations_and_shortening_purges_immediately() {
        let old = session("2026-08-01T00:00:00Z");
        let current = session("2026-09-13T00:00:00Z");
        let now = parse_time("2026-09-13T12:00:00Z").unwrap();
        let mut store = CodexSessionStore {
            retention_days: 30,
            sessions: vec![old],
            deleted_session_ids: HashSet::new(),
        };
        purge_expired(&mut store, now);
        assert!(store.sessions.is_empty());
        store.sessions.push(current);
        store.retention_days = 0;
        purge_expired(&mut store, now);
        assert!(store.sessions.is_empty());
    }

    #[test]
    fn serializes_new_dto_fields_and_accepts_old_json_without_them() {
        let value = CodexSessionStore {
            retention_days: 30,
            sessions: vec![session("2026-09-13T00:00:00Z")],
            deleted_session_ids: HashSet::new(),
        };
        let bytes = serde_json::to_vec(&value).unwrap();
        let restored: CodexSessionStore = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(restored.sessions[0].draft.instruction, "下書き");
        assert_eq!(
            restored.sessions[0].draft.target_label.as_deref(),
            Some("対象テキスト1")
        );
        assert_eq!(restored.sessions[0].next_text_target_number, Some(2));

        let mut legacy = serde_json::to_value(&value).unwrap();
        let session = legacy["sessions"][0].as_object_mut().unwrap();
        session.remove("nextTextTargetNumber");
        session
            .get_mut("draft")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove("targetLabel");
        let restored_legacy: CodexSessionStore = serde_json::from_value(legacy).unwrap();
        assert_eq!(restored_legacy.sessions[0].draft.target_label, None);
        assert_eq!(restored_legacy.sessions[0].next_text_target_number, None);
        assert!(restored_legacy.sessions[0].draft.text_targets.is_empty());
        assert!(restored_legacy.sessions[0].messages[0].attachment_labels.is_empty());
    }
    #[test]
    fn preserves_named_text_targets_and_rejects_duplicate_ids() {
        let mut value = session("2026-09-13T00:00:00Z");
        value.document_id = Some("tab-1:3".into());
        value.draft.text_targets = vec![CodexConversationTextTarget {
            id: "text-1".into(), label: "要約する段落".into(),
            snapshot: CodexDraftSnapshot { document_id: "tab-1:3".into(), content: "本文abc".into(), from: 0, to: 2 },
            added_at: "2026-09-13T00:00:00Z".into(),
        }];
        assert!(validate_conversation(&value).is_ok());
        let restored: CodexConversation = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(restored.draft.text_targets[0].label, "要約する段落");
        assert_eq!(restored.draft.text_targets[0].snapshot.to, 2);
        assert_eq!(restored.document_id.as_deref(), Some("tab-1:3"));
        let mut invalid = value.clone();
        invalid.draft.text_targets[0].snapshot.document_id = "../other".into();
        assert!(validate_conversation(&invalid).is_err());
        value.draft.text_targets.push(value.draft.text_targets[0].clone());
        assert!(validate_conversation(&value).is_err());
    }
    #[test]
    fn delayed_autosave_cannot_restore_expired_or_newer_conversations() {
        let now = parse_time("2026-09-13T12:00:00Z").unwrap();
        let mut store = CodexSessionStore {
            retention_days: 1,
            sessions: vec![],
            deleted_session_ids: HashSet::new(),
        };
        merge_session(&mut store, session("2026-09-01T00:00:00Z"), now);
        assert!(store.sessions.is_empty());
        merge_session(&mut store, session("2026-09-13T10:00:00Z"), now);
        merge_session(&mut store, session("2026-09-13T09:00:00Z"), now);
        assert_eq!(store.sessions[0].updated_at, "2026-09-13T10:00:00Z");
        store.retention_days = 0;
        merge_session(&mut store, session("2026-09-13T11:00:00Z"), now);
        assert!(store.sessions.is_empty());
    }

    #[test]
    fn delete_session_removes_only_the_selected_conversation_and_blocks_delayed_autosave() {
        let now = parse_time("2026-09-13T12:00:00Z").unwrap();
        let mut value = session("2026-09-13T10:00:00Z");
        value.attachments.push(CodexConversationAttachment {
            id: "attachment-1".into(),
            label: "画像1".into(),
            base64: "aW1hZ2U=".into(),
            mime: "image/png".into(),
            name: "selected.png".into(),
            added_at: "2026-09-13T10:00:00Z".into(),
        });
        value.messages[0].attachment_ids.push("attachment-1".into());
        value.draft.attachment_ids.push("attachment-1".into());
        let mut other = session("2026-09-13T11:00:00Z");
        other.id = "conversation-2".into();
        other.attachments.push(CodexConversationAttachment {
            id: "attachment-2".into(),
            label: "画像2".into(),
            base64: "aW1hZ2U=".into(),
            mime: "image/png".into(),
            name: "kept.png".into(),
            added_at: "2026-09-13T11:00:00Z".into(),
        });
        other.messages[0].attachment_ids.push("attachment-2".into());
        let mut store = CodexSessionStore {
            retention_days: 30,
            sessions: vec![value.clone(), other],
            deleted_session_ids: HashSet::new(),
        };
        delete_session(&mut store, &value.id, now);
        assert_eq!(store.sessions.len(), 1);
        assert_eq!(store.sessions[0].id, "conversation-2");
        assert_eq!(store.sessions[0].attachments[0].name, "kept.png");
        merge_session(&mut store, value, now);
        assert_eq!(store.sessions.len(), 1);
        let bytes = serde_json::to_vec(&store).unwrap();
        let restored: CodexSessionStore = serde_json::from_slice(&bytes).unwrap();
        assert!(restored.deleted_session_ids.contains("conversation-1"));
    }
}
