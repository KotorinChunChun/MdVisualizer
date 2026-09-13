export interface EditorSnapshot { documentId: string; content: string; from: number; to: number }
export type CodexTool = "codex-cli" | "chatgpt-api" | "claude-cli" | "claude-api" | "copilot-cli" | "copilot-chat-cli";
export interface CodexOptions { enabled: boolean; model: string; tool: CodexTool }
export interface ChatMessage { role: "user" | "assistant"; text: string }
export interface CodexReply { answer: string; replacement: string | null; inputTokens?: number }
export interface CodexLogEntry {
  id: string;
  createdAt: string;
  model: string;
  requestPrompt: string;
  responseText: string;
  responseRaw: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}
export interface CodexLogData { entries: CodexLogEntry[]; limit: number }
export const DEFAULT_CODEX_OPTIONS: CodexOptions = { enabled: false, model: "gpt-5.6-luna", tool: "codex-cli" };
export function normalizeCodexOptions(value: unknown): CodexOptions {
  const v = (value && typeof value === "object" ? value : {}) as Partial<CodexOptions>;
  const tool = ["codex-cli", "chatgpt-api", "claude-cli", "claude-api", "copilot-cli", "copilot-chat-cli"].includes(String(v.tool)) ? v.tool as CodexTool : "codex-cli";
  // ツールの選択と、利用者が初回送信で同意する有効化は別の操作として扱う。
  return { enabled: tool === "codex-cli" && v.enabled === true, model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULT_CODEX_OPTIONS.model, tool };
}
export function canApplyProposal(current: EditorSnapshot | null, base: EditorSnapshot): boolean {
  return Boolean(current && current.documentId === base.documentId && current.content === base.content
    && Number.isInteger(base.from) && Number.isInteger(base.to) && base.from >= 0 && base.to >= base.from && base.to <= base.content.length);
}
export function requestBytes(instruction: string, text: string, history: ChatMessage[]): number {
  return new TextEncoder().encode(instruction + text + history.map((m) => m.text).join("")).length;
}
