import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelCodex, generateCodex, listCodexLogs, setCodexLogLimit } from "./api";
import { CodexPanel } from "./CodexPanel";
import { loadSettings, saveSettings } from "../../lib/commands";
import type { CodexReply, EditorSnapshot } from "./model";
import type { CodexConversation } from "./sessions";
const sessionMock = vi.hoisted(() => ({ sessions: [] as CodexConversation[], retentionDays: 30 }));
vi.mock("./api", () => ({
    generateCodex: vi.fn(),
    cancelCodex: vi.fn().mockResolvedValue(undefined),
    listCodexLogs: vi.fn(),
    setCodexLogLimit: vi.fn(),
}));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("./sessions", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./sessions")>();
    return {
        ...actual,
        loadCodexSessions: vi.fn(async () => ({ sessions: sessionMock.sessions, retentionDays: sessionMock.retentionDays })),
        upsertCodexSession: vi.fn(async (session: CodexConversation) => {
            if (sessionMock.retentionDays === 0)
                return { sessions: [], retentionDays: 0 };
            sessionMock.sessions = [session, ...sessionMock.sessions.filter((item) => item.id !== session.id)];
            return { sessions: sessionMock.sessions, retentionDays: sessionMock.retentionDays };
        }),
        setCodexSessionRetention: vi.fn(async (retentionDays: number) => {
            sessionMock.retentionDays = retentionDays;
            if (retentionDays === 0)
                sessionMock.sessions = [];
            return { sessions: sessionMock.sessions, retentionDays };
        }),
    };
});
vi.mock("./imageTranscription", () => ({
    transcriptionImages: vi.fn(() => [{ source: "image.png" }]),
    loadTranscriptionImage: vi.fn(async () => ({ base64: "aW1hZ2U=", mime: "image/png" })),
}));
vi.mock("./skills", () => ({ useCodexSkills: () => [] }));
const settings = { codex: { enabled: true, model: "gpt-5.6-luna" } };
const snapshot: EditorSnapshot = { documentId: "a:1", content: "未保存の文章です。", from: 0, to: 3 };
function mount(options: {
    current?: EditorSnapshot;
    apply?: (base: EditorSnapshot, replacement: string) => boolean;
    target?: {
        documentId: string;
        content: string;
        from: number;
        to: number;
        imageSource?: string;
        editMode?: "question" | "selection" | "document";
        conversationAction?: "add" | "new";
    };
    documentPath?: string;
} = {}) {
    let current = options.current ?? snapshot;
    const apply = options.apply ?? vi.fn().mockReturnValue(true);
    const view = render(<CodexPanel open onClose={vi.fn()} documentName="test.md" documentText={current.content} documentPath={options.documentPath} available consultationTarget={options.target} getSnapshot={() => current} applyProposal={apply}/>);
    return { ...view, apply, setSnapshot: (next: EditorSnapshot) => { current = next; } };
}
async function send(text = "短くして") {
    await screen.findByLabelText("指示");
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" }));
}
beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.sessions = [];
    sessionMock.retentionDays = 30;
    vi.mocked(loadSettings).mockResolvedValue(settings);
    vi.mocked(saveSettings).mockResolvedValue(settings);
    vi.mocked(generateCodex).mockResolvedValue({ answer: "短縮しました", replacement: "短い文章。" });
    vi.mocked(listCodexLogs).mockResolvedValue({ entries: [], limit: 20 });
    vi.mocked(setCodexLogLimit).mockResolvedValue({ entries: [], limit: 20 });
});
afterEach(cleanup);
describe("Codexパネル", () => {
    it("テキストを取り込むと選択範囲だけを許可し、選択を解除すると全体へ戻す", async () => {
        const view = mount();
        fireEvent.click(await screen.findByRole("button", { name: "対象テキストを取り込む" }));
        expect(screen.getByLabelText("編集の許可")).toHaveValue("selection");
        view.setSnapshot({ ...snapshot, from: 0, to: 0 });
        fireEvent.click(screen.getByRole("button", { name: "対象テキストを取り込む" }));
        expect(screen.getByLabelText("編集の許可")).toHaveValue("document");
        expect(screen.queryByRole("option", { name: "指定場所のみ編集" })).not.toBeInTheDocument();
    });
    it("選択がない時は文書全体を編集対象として表示し送信する", async () => {
        mount();
        expect(await screen.findByText("文書全体を編集")).toBeVisible();
        await send();
        await waitFor(() => expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: snapshot.content })));
    });
    it("質問モードは選択本文だけを送り、変更案を採用させない", async () => {
        mount({ target: { ...snapshot, editMode: "question" } });
        await send("説明して");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: "未保存", instruction: expect.stringContaining("replacementは必ずnull") })));
        expect(screen.queryByRole("button", { name: "採用" })).not.toBeInTheDocument();
    });
    it("画像の実データと会話内ラベルを対応付けて送る", async () => {
        mount({ target: { ...snapshot, imageSource: "image.png", editMode: "question" } });
        await screen.findByLabelText("指示");
        fireEvent.click(screen.getByRole("button", { name: "現在の画像を追加" }));
        await waitFor(() => expect(screen.getByLabelText("添付画像")).toHaveTextContent("画像1"));
        await send("画像を説明して");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ images: [{ base64: "aW1hZ2U=" }], instruction: expect.stringContaining("1枚目=画像1") })));
        expect(screen.getByRole("log")).toHaveTextContent("画像1");
    });
    it("成功時は指示だけを消し、対象テキストと画像は残す", async () => {
        mount({ target: { ...snapshot, imageSource: "image.png", editMode: "question" } });
        fireEvent.click(await screen.findByRole("button", { name: "現在の画像を追加" }));
        await waitFor(() => expect(screen.getByLabelText("添付画像")).toBeInTheDocument());
        await send("説明して");
        await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue(""));
        expect(screen.getByLabelText("添付画像")).toHaveTextContent("画像1");
    });
    it("送信失敗時は下書きと対象を保持する", async () => {
        vi.mocked(generateCodex).mockRejectedValue("CLI未導入");
        mount({ target: { ...snapshot, editMode: "selection" } });
        await send();
        await screen.findByRole("alert");
        expect(screen.getByLabelText("指示")).toHaveValue("短くして");
        expect(screen.getByText("対象テキスト")).toBeVisible();
    });
    it("変更案は採用確認を経て本文へ反映する", async () => {
        const { apply } = mount();
        await send();
        fireEvent.click(await screen.findByRole("button", { name: "採用" }));
        await waitFor(() => expect(apply).toHaveBeenCalledWith({ ...snapshot, from: 0, to: snapshot.content.length }, "短い文章。"));
    });
    it("本文競合時は採用を中止してエラーを表示する", async () => {
        const { apply, setSnapshot } = mount();
        await send();
        await screen.findByRole("button", { name: "採用" });
        setSnapshot({ ...snapshot, content: "変更済み" });
        fireEvent.click(screen.getByRole("button", { name: "採用" }));
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("本文や文書が変わりました"));
        expect(apply).not.toHaveBeenCalled();
    });
    it("停止後または会話切替後に届く回答を現在の会話へ混在させない", async () => {
        let resolve!: (reply: CodexReply) => void;
        vi.mocked(generateCodex).mockImplementation(() => new Promise((done) => { resolve = done; }));
        const view = mount();
        await send();
        fireEvent.click(screen.getByRole("button", { name: "新しい会話を開始" }));
        await act(async () => { resolve({ answer: "遅い回答", replacement: "上書き" }); });
        expect(cancelCodex).toHaveBeenCalled();
        expect(screen.queryByText("遅い回答")).not.toBeInTheDocument();
        view.unmount();
    });
    it("文書に紐付く下書きを保存し、次の起動で復元する", async () => {
        const first = mount({ documentPath: "C:/docs/test.md" });
        await send("再起動後にも残す");
        await waitFor(() => expect(sessionMock.sessions.some((item) => item.draft.instruction === "")).toBe(true));
        first.unmount();
        sessionMock.sessions[0] = { ...sessionMock.sessions[0], draft: { ...sessionMock.sessions[0].draft, instruction: "保存済み下書き" } };
        mount({ documentPath: "C:/docs/test.md" });
        await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue("保存済み下書き"));
    });
    it("履歴の保持日数を0日にしても履歴画面を開ける", async () => {
        mount();
        fireEvent.click(await screen.findByRole("button", { name: /会話履歴/ }));
        const input = await screen.findByLabelText("会話履歴の保持日数");
        fireEvent.change(input, { target: { value: "0" } });
        fireEvent.blur(input);
        await waitFor(() => expect(sessionMock.retentionDays).toBe(0));
    });
});
