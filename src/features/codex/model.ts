export interface EditorSnapshot { documentId: string; content: string; from: number; to: number }
export interface CodexOptions { enabled: boolean; model: string }
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
export const DEFAULT_CODEX_OPTIONS: CodexOptions = { enabled: false, model: "gpt-5.6-luna" };
export function normalizeCodexOptions(value: unknown): CodexOptions {
  const v = (value && typeof value === "object" ? value : {}) as Partial<CodexOptions>;
  return { enabled: v.enabled === true, model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULT_CODEX_OPTIONS.model };
}
export function canApplyProposal(current: EditorSnapshot | null, base: EditorSnapshot): boolean {
  return Boolean(current && current.documentId === base.documentId && current.content === base.content
    && Number.isInteger(base.from) && Number.isInteger(base.to) && base.from >= 0 && base.to >= base.from && base.to <= base.content.length);
}
export function requestBytes(instruction: string, text: string, history: ChatMessage[]): number {
  return new TextEncoder().encode(instruction + text + history.map((m) => m.text).join("")).length;
}
