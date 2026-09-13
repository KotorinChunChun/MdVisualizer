import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexPanel } from "./CodexPanel";
import { generateCodex, listCodexLogs } from "./api";
import { loadSettings } from "../../lib/commands";
import type { CodexConversation } from "./sessions";

const store = vi.hoisted(() => ({ sessions: [] as CodexConversation[] }));

vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn(), listCodexLogs: vi.fn(), setCodexLogLimit: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("./preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./preview")>();
  return { ...actual, diagramImage: vi.fn(async () => ({ base64: "ZGlhZ3JhbQ==", mime: "image/png" })) };
});
vi.mock("./sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sessions")>();
  return {
    ...actual,
    loadCodexSessions: vi.fn(async () => ({ sessions: store.sessions, retentionDays: 30 })),
    upsertCodexSession: vi.fn(async (session: CodexConversation) => {
      store.sessions = [session, ...store.sessions.filter(item => item.id !== session.id)];
      return { sessions: store.sessions, retentionDays: 30 };
    }),
    setCodexSessionRetention: vi.fn(async () => ({ sessions: store.sessions, retentionDays: 30 })),
  };
});
vi.mock("./skills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills")>();
  return { ...actual, useCodexSkills: () => actual.DEFAULT_SKILL_FILES.map(actual.parseSkill) };
});
vi.mock("./imageTranscription", () => ({
  transcriptionImages: vi.fn(() => [{ source: "image.png", start: 0, end: 18 }]),
  loadTranscriptionImage: vi.fn(async () => ({ base64: "cG5n", mime: "image/png" })),
}));

const content = "```mermaid\ngraph TD\nA-->B\n```";
const snapshot = { documentId: "doc", content, from: 0, to: content.length };
const target = (skillId: string, action: "add" | "new" = "new") => ({ ...snapshot, targetKind: "mermaid" as const, skillId, conversationAction: action });

function mount(skillId: string, action: "add" | "new" = "new", extra: Record<string, unknown> = {}) {
  return render(<CodexPanel open onClose={vi.fn()} documentName="diagram.md" documentText={snapshot.content} available consultationTarget={target(skillId, action)} getSnapshot={() => snapshot} applyProposal={vi.fn(() => true)} {...extra} />);
}
async function send() {
  await screen.findByLabelText("添付画像");
  fireEvent.click(await screen.findByRole("button", { name: "送信（Ctrl+Enter）" }));
  await waitFor(() => expect(generateCodex).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  store.sessions = [];
  vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: true, model: "gpt-5.6-luna" } });
  vi.mocked(listCodexLogs).mockResolvedValue({ entries: [], limit: 20 });
  vi.mocked(generateCodex).mockResolvedValue({ answer: "回答", replacement: null });
});
afterEach(cleanup);

describe("CodexPanel の既定スキル入力", () => {
  it("explain-image は実画像だけを送り、既定プロンプトと質問モードを下書きへ入れる", async () => {
    mount("explain-image");
    const input = await screen.findByLabelText("指示");
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toContain("添付された可視化後の画像"));
    expect(screen.getByLabelText("編集の許可")).toHaveValue("question");
    await send();
    expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: "", images: [{ base64: "ZGlhZ3JhbQ==" }] }));
  });

  it("improve-diagram は元コードと可視化画像を同時に送る", async () => {
    mount("improve-diagram");
    await send();
    expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: content, images: [{ base64: "ZGlhZ3JhbQ==" }] }));
  });

  it("MarkdownのMermaid右クリックは入力本文にフェンスを保持する", async () => {
    mount("improve-diagram");
    await send();
    expect(vi.mocked(generateCodex).mock.calls[0][0].text).toContain("```mermaid");
  });

  it("PNG edit-image は画像を自動読込し、画像編集ウィジェットだけを表示する", async () => {
    render(<CodexPanel open onClose={vi.fn()} documentName="image.md" documentText="![x](image.png)" available consultationTarget={{ documentId: "png", content: "![x](image.png)", from: 0, to: 15, imageSource: "image.png", skillId: "edit-image", conversationAction: "new" }} getSnapshot={() => ({ documentId: "png", content: "![x](image.png)", from: 0, to: 15 })} applyProposal={vi.fn(() => true)} />);
    expect(await screen.findByLabelText("Codexで画像を編集")).toBeVisible();
    expect(screen.queryByLabelText("指示")).not.toBeInTheDocument();
  });

  it("add は保存済み会話を再開し、new は履歴を持ち込まない", async () => {
    const saved: CodexConversation = { id: "saved", title: "前の会話", documentId: "old", documentPath: "", messages: [{ role: "user", text: "前の質問", attachmentIds: [], timestamp: "2026-09-13T00:00:00Z" }], attachments: [], draft: { instruction: "続き", targetSnapshot: null, editMode: "question", attachmentIds: [] }, createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z", lastMessageAt: "2026-09-13T00:00:00Z" };
    store.sessions = [saved];
    const first = mount("explain-image", "add");
    expect(await screen.findByText("前の質問")).toBeVisible();
    first.unmount();
    mount("explain-image", "new");
    await screen.findByLabelText("指示");
    expect(screen.queryByText("前の質問")).not.toBeInTheDocument();
  });
});
