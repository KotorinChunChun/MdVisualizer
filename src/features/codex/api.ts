import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, CodexLogData, CodexReply } from "./model";
export function generateCodex(request: { id: string; instruction: string; text: string; history: ChatMessage[] }): Promise<CodexReply> {
  return invoke("codex_generate", { request });
}
export function cancelCodex(id: string): Promise<void> { return invoke("codex_cancel", { id }); }
export function listCodexLogs(): Promise<CodexLogData> { return invoke("codex_list_logs"); }
export function setCodexLogLimit(limit: number): Promise<CodexLogData> { return invoke("codex_set_log_limit", { limit }); }
