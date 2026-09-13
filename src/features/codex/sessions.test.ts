import { describe, expect, it } from "vitest";
import { contextAmountLabel, conversationCharacterCount, isConversationRecent, type CodexConversation } from "./sessions";

const session: CodexConversation = { id: "conversation-1", title: "質問", messages: [{ role: "user", text: "こんにちは", attachmentIds: [], timestamp: "2026-09-13T00:00:00Z" }, { role: "assistant", text: "回答", attachmentIds: [], timestamp: "2026-09-13T00:01:00Z" }], attachments: [], draft: { instruction: "", targetSnapshot: null, editMode: "question", attachmentIds: [] }, createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:01:00Z", lastMessageAt: "2026-09-13T00:01:00Z" };

describe("Codex conversation session helpers", () => {
  it("counts only stored message characters and never presents an estimate as context data", () => {
    expect(conversationCharacterCount(session)).toBe(7);
    expect(contextAmountLabel(session)).toBe("不明（接続時に取得）");
    expect(contextAmountLabel({ ...session, contextTokens: 1234 })).toBe("直近入力 1,234 tokens");
  });
  it("uses one hour as an indicator without treating it as a cache guarantee", () => {
    expect(isConversationRecent(session, Date.parse("2026-09-13T01:00:00Z"))).toBe(true);
    expect(isConversationRecent(session, Date.parse("2026-09-13T01:01:01Z"))).toBe(false);
  });
});
