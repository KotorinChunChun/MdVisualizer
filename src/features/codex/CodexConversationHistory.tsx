import { useEffect, useMemo, useState } from "react";
import { contextAmountLabel, conversationCharacterCount, isConversationRecent, type CodexConversation } from "./sessions";

export function CodexConversationHistory({ sessions, selectedId, retentionDays, onSelect, onClose, onRetentionChange, onDelete }: {
  sessions: CodexConversation[];
  selectedId: string | null;
  retentionDays: number;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRetentionChange: (days: number) => void;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [image, setImage] = useState<{ source: string; label: string } | null>(null);
  const [retentionInput, setRetentionInput] = useState(String(retentionDays));
  const [now, setNow] = useState(Date.now());
  const [previewId, setPreviewId] = useState(selectedId);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => setRetentionInput(String(retentionDays)), [retentionDays]);
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (image) setImage(null);
      else onClose();
    };
    window.addEventListener("keydown", closeWithEscape, true);
    return () => window.removeEventListener("keydown", closeWithEscape, true);
  }, [image, onClose]);
  const ordered = useMemo(() => [...sessions].sort((left, right) => Date.parse(right.lastMessageAt ?? right.updatedAt) - Date.parse(left.lastMessageAt ?? left.updatedAt)), [sessions]);
  const selected = ordered.find((session) => session.id === previewId) ?? null;
  const setRetention = () => {
    const value = Number(retentionInput);
    if (Number.isInteger(value) && value >= 0 && value <= 3650) onRetentionChange(value);
    else setRetentionInput(String(retentionDays));
  };
  const deleteSelected = async () => {
    if (!selected || !onDelete || deletingId) return;
    setDeleteError(null);
    setDeletingId(selected.id);
    try {
      await onDelete(selected.id);
      setPreviewId(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingId(null);
    }
  };
  return <section className="codex-conversation-history" aria-label="Codex会話履歴">
    <header><div><strong>会話履歴</strong><p>会話を開いただけでは最終会話日時は変わりません。</p></div><button type="button" onClick={onClose} aria-label="会話履歴を閉じる">×</button></header>
    <div className="codex-conversation-history__content">
      <nav aria-label="保存した会話">
        <div className="codex-conversation-history__list">
          {ordered.length === 0 && <p>保存された会話はありません。</p>}
          {ordered.map((session) => {
            const recent = isConversationRecent(session, now);
            return <button key={session.id} type="button" className={session.id === previewId ? "is-selected" : ""} onClick={() => setPreviewId(session.id)}>
              <strong>{session.title || "無題の会話"}</strong>
              <span>{session.lastMessageAt && <i className={recent ? "is-recent" : "is-old"} aria-label={recent ? "最終会話から1時間以内" : "最終会話から1時間超"} />}{formatDate(session.lastMessageAt)}{session.lastMessageAt && `（${Math.max(0, Math.floor((now - Date.parse(session.lastMessageAt)) / 60000))}分前）`}</span>
              <small>{conversationCharacterCount(session).toLocaleString()} 文字 / コンテキスト量: {contextAmountLabel(session)}</small>
            </button>;
          })}
        </div>
        <footer><label>保持日数<input aria-label="会話履歴の保持日数" type="number" min="0" max="3650" value={retentionInput} onChange={(event) => setRetentionInput(event.target.value)} onBlur={setRetention} /></label><small>0日にすると履歴と下書きを消去し、以後保存しません。</small></footer>
      </nav>
      <main>
        {!selected && <p className="codex-conversation-history__empty">会話を選択してください。</p>}
        {selected && <>
          <header><div><h2>{selected.title || "無題の会話"}</h2><p>{selected.documentPath || "文書に紐付かない会話"}</p></div><span>{conversationCharacterCount(selected).toLocaleString()} 文字</span><button type="button" onClick={() => onSelect(selected.id)}>この会話を開く</button><button type="button" className="codex-conversation-history__delete" disabled={!onDelete || deletingId !== null} onClick={() => void deleteSelected()}>{deletingId === selected.id ? "削除中…" : "この会話を削除"}</button></header>
          {deleteError && <p className="codex-conversation-history__delete-error" role="alert">会話を削除できませんでした: {deleteError}</p>}
          {!isConversationRecent(selected) && selected.lastMessageAt && <p className="codex-conversation-history__cache-note">最終会話から1時間以上経過しています。キャッシュを利用できない可能性があり、入力の再処理による利用量・コストが増える場合があります。</p>}
          <div className="codex-conversation-history__messages" role="log">
            {selected.messages.map((message, index) => <article key={`${message.timestamp}-${index}`} className={`codex-message codex-message--${message.role}`}><strong>{message.role === "user" ? "あなた" : "Codex"}</strong><time>{formatDate(message.timestamp)}</time><pre>{message.text}</pre>{message.attachmentIds.map((id) => {
              const attachment = selected.attachments.find((candidate) => candidate.id === id);
              if (!attachment) return null;
              const source = `data:${attachment.mime};base64,${attachment.base64}`;
              return <button key={id} className="codex-conversation-history__attachment" type="button" onClick={() => setImage({ source, label: attachment.label })}><img src={source} alt={`${attachment.label}のサムネイル`} /><span>{attachment.label}</span></button>;
            })}</article>)}
          </div>
        </>}
      </main>
    </div>
    {image && <div className="codex-conversation-history__image-dialog" role="dialog" aria-modal="true" aria-label={`${image.label}を拡大`} onClick={() => setImage(null)}><figure onClick={(event) => event.stopPropagation()}><img src={image.source} alt={image.label} /><figcaption>{image.label}<button type="button" onClick={() => setImage(null)}>閉じる</button></figcaption></figure></div>}
  </section>;
}

function formatDate(value: string | null): string {
  if (!value) return "未送信";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日時不明" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(date);
}
