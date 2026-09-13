import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexConversationHistory } from "./CodexConversationHistory";
import type { CodexConversation } from "./sessions";

const session: CodexConversation = { id: "conversation-1", title: "画像の相談", documentId: "document-1", documentPath: "C:\\docs\\note.md", messages: [{ role: "user", text: "この画像を説明して", attachmentIds: ["attachment-1"], timestamp: "2026-09-13T00:00:00Z" }], attachments: [{ id: "attachment-1", label: "画像1", base64: "cG5n", mime: "image/png", name: "chart.png", addedAt: "2026-09-13T00:00:00Z" }], draft: { instruction: "下書き", targetSnapshot: null, editMode: "question", attachmentIds: [] }, createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z", lastMessageAt: "2026-09-13T00:00:00Z" };

afterEach(cleanup);
describe("CodexConversationHistory", () => {
  it("selects a conversation without writing its last message timestamp and opens an attachment preview", () => {
    const onSelect = vi.fn();
    render(<CodexConversationHistory sessions={[session]} selectedId={null} retentionDays={30} onSelect={onSelect} onClose={vi.fn()} onRetentionChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /画像の相談/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("この画像を説明して")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "この会話を開く" }));
    expect(onSelect).toHaveBeenCalledWith("conversation-1");
    expect(session.lastMessageAt).toBe("2026-09-13T00:00:00Z");
  });
  it("shows an attached image with its stable label and allows the full-size check", () => {
    render(<CodexConversationHistory sessions={[session]} selectedId="conversation-1" retentionDays={30} onSelect={vi.fn()} onClose={vi.fn()} onRetentionChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /画像1/ }));
    expect(screen.getByRole("dialog", { name: "画像1を拡大" })).not.toBeNull();
  });
});
