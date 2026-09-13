import { invoke } from "@tauri-apps/api/core";
import type { EditorSnapshot } from "./model";

export type CodexConversationRole = "user" | "assistant";

export interface CodexConversationAttachment {
  id: string;
  label: string;
  base64: string;
  mime: string;
  name: string;
  addedAt: string;
}

export interface CodexConversationMessage {
  role: CodexConversationRole;
  text: string;
  attachmentIds: string[];
  timestamp: string;
}

export interface CodexConversationDraft {
  instruction: string;
  targetSnapshot: EditorSnapshot | null;
  editMode: "selection" | "document" | "question";
  attachmentIds: string[];
}

export interface CodexConversation {
  id: string;
  title: string;
  documentId?: string;
  documentPath?: string;
  messages: CodexConversationMessage[];
  attachments: CodexConversationAttachment[];
  draft: CodexConversationDraft;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  /** Codex CLIが直近の送信で返した実測input_tokens。累積値でも推定値でもない。 */
  contextTokens?: number;
}

export interface CodexSessionStore {
  retentionDays: number;
  sessions: CodexConversation[];
}

export const DEFAULT_CODEX_SESSION_RETENTION_DAYS = 30;

export async function loadCodexSessions(): Promise<CodexSessionStore> {
  return await invoke<CodexSessionStore>("load_codex_sessions");
}

export async function upsertCodexSession(session: CodexConversation): Promise<CodexSessionStore> {
  return await invoke<CodexSessionStore>("upsert_codex_session", { session });
}

export async function setCodexSessionRetention(retentionDays: number): Promise<CodexSessionStore> {
  return await invoke<CodexSessionStore>("set_codex_session_retention", { retentionDays });
}

export function conversationCharacterCount(session: CodexConversation): number {
  return session.messages.reduce((total, message) => total + message.text.length, 0);
}

export function isConversationRecent(session: CodexConversation, now = Date.now()): boolean {
  if (!session.lastMessageAt) return false;
  const timestamp = Date.parse(session.lastMessageAt);
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= 60 * 60 * 1000;
}

export function contextAmountLabel(_session: CodexConversation): string {
  // CLIが返さない会話について、文字数からトークン数を推定して表示しない。
  return typeof _session.contextTokens === "number" && Number.isSafeInteger(_session.contextTokens) && _session.contextTokens >= 0
    ? `直近入力 ${_session.contextTokens.toLocaleString()} tokens`
    : "不明（接続時に取得）";
}
