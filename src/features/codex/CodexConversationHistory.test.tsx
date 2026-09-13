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
  it("closes the image before the history on Escape, and consumes the event", () => {
    const onClose = vi.fn();
    render(<CodexConversationHistory sessions={[session]} selectedId="conversation-1" retentionDays={30} onSelect={vi.fn()} onClose={onClose} onRetentionChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /画像1/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "画像1を拡大" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("deletes only the selected conversation and reports a deletion failure in the history", async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error("保存先が使えません")).mockResolvedValueOnce(undefined);
    render(<CodexConversationHistory sessions={[session]} selectedId="conversation-1" retentionDays={30} onSelect={vi.fn()} onClose={vi.fn()} onRetentionChange={vi.fn()} onDelete={onDelete} />);
    const button = screen.getByRole("button", { name: "この会話を削除" });
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("保存先が使えません");
    fireEvent.click(button);
    await vi.waitFor(() => expect(onDelete).toHaveBeenLastCalledWith("conversation-1"));
  });
  it("prevents duplicate deletion while the selected conversation is being deleted", async () => {
    let complete!: () => void;
    const onDelete = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    render(<CodexConversationHistory sessions={[session]} selectedId="conversation-1" retentionDays={30} onSelect={vi.fn()} onClose={vi.fn()} onRetentionChange={vi.fn()} onDelete={onDelete} />);
    const button = screen.getByRole("button", { name: "この会話を削除" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    complete();
    await vi.waitFor(() => expect(screen.getByText("会話を選択してください。")).not.toBeNull());
  });
});
