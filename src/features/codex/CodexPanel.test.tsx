import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelCodex, generateCodex, listCodexLogs, setCodexLogLimit } from "./api";
import { CodexPanel, replacementMatchesTargetRanges } from "./CodexPanel";
import { loadSettings, saveSettings } from "../../lib/commands";
import type { CodexReply, EditorSnapshot } from "./model";
import type { CodexConversation } from "./sessions";
import { upsertCodexSession } from "./sessions";
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
        deleteCodexSession: vi.fn(async (id: string) => {
            sessionMock.sessions = sessionMock.sessions.filter(item => item.id !== id);
            return { sessions: sessionMock.sessions, retentionDays: sessionMock.retentionDays };
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
    maximized?: boolean;
    onToggleMaximized?: () => void;
} = {}) {
    let current = options.current ?? snapshot;
    const apply = options.apply ?? vi.fn().mockReturnValue(true);
    const view = render(<CodexPanel open onClose={vi.fn()} documentName="test.md" documentText={current.content} documentPath={options.documentPath} available consultationTarget={options.target} maximized={options.maximized} onToggleMaximized={options.onToggleMaximized} getSnapshot={() => current} applyProposal={apply}/>);
    return { ...view, apply, setSnapshot: (next: EditorSnapshot) => { current = next; } };
}
async function send(text = "短くして") {
    await screen.findByLabelText("指示");
    await waitFor(() => expect(screen.getByLabelText("指示")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" }));
}
beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sessionMock.sessions = [];
    sessionMock.retentionDays = 30;
    vi.mocked(loadSettings).mockResolvedValue(settings);
    vi.mocked(saveSettings).mockResolvedValue(settings);
    vi.mocked(generateCodex).mockResolvedValue({ answer: "短縮しました", replacement: "短い文章。" });
    vi.mocked(listCodexLogs).mockResolvedValue({ entries: [], limit: 20 });
    vi.mocked(setCodexLogLimit).mockResolvedValue({ entries: [], limit: 20 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); });
describe("Codexパネル", () => {
    it("初回送信は同意後にだけAIを有効化して送信する", async () => {
        vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: false, model: "gpt-5.6-luna" } });
        vi.spyOn(window, "confirm").mockReturnValue(true);
        mount();
        await send("初回の送信");
        await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ codex: expect.objectContaining({ enabled: true, tool: "codex-cli" }) }));
        expect(generateCodex).toHaveBeenCalledTimes(1);
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("サブスクリプションのクレジット"));
    });
    it("初回同意を拒否すると指示を保持しAIへ送信しない", async () => {
        vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: false, model: "gpt-5.6-luna" } });
        vi.spyOn(window, "confirm").mockReturnValue(false);
        mount();
        await send("同意しない送信");
        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        expect(generateCodex).not.toHaveBeenCalled();
        expect(screen.getByLabelText("指示")).toHaveValue("同意しない送信");
    });
    it("同意済みならモデル変更やツールの戻しで確認を繰り返さない", async () => {
        mount();
        await screen.findByLabelText("ツール");
        fireEvent.change(screen.getByLabelText("モデル"), { target: { value: "gpt-5.6-terra" } });
        await send("モデル変更後");
        await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ codex: expect.objectContaining({ enabled: true, model: "gpt-5.6-terra" }) }));
        expect(window.confirm).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText("ツール"), { target: { value: "chatgpt-api" } });
        fireEvent.change(screen.getByLabelText("ツール"), { target: { value: "codex-cli" } });
        await send("ツールを戻した後");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(2));
        expect(window.confirm).not.toHaveBeenCalled();
    });
    it("エディタの準備前の下書きは空の文書IDを保存せず、取り込み時に確定する", async () => {
        let current: EditorSnapshot | null = null;
        render(<CodexPanel open onClose={vi.fn()} documentName="loading.md" documentText="本文" documentPath="C:/loading.md" available getSnapshot={() => current} applyProposal={vi.fn()} />);
        await waitFor(() => expect(screen.getByLabelText("ツール")).toBeEnabled());
        fireEvent.change(screen.getByLabelText("指示"), { target: { value: "準備中の下書き" } });
        await waitFor(() => expect(sessionMock.sessions).toHaveLength(1));
        expect(sessionMock.sessions[0].documentId).toBeUndefined();
        current = { documentId: "tab-1", content: "本文", from: 0, to: 2 };
        fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" }));
        await waitFor(() => expect(sessionMock.sessions[0].draft.textTargets).toHaveLength(1));
        expect(sessionMock.sessions[0].documentId).toBe("tab-1");
    });
    it("複数テキストを改名・除去し、質問には残った抜粋だけを送る", async () => {
        vi.mocked(generateCodex).mockResolvedValue({ answer: "比較しました", replacement: null });
        const full = "一つ目\n送らない部分\n二つ目";
        const current = { documentId: "multi", content: full, from: 0, to: 3 };
        const view = mount({ current });
        await waitFor(() => expect(screen.getByLabelText("指示")).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" }));
        fireEvent.change(screen.getByLabelText("テキスト1の名前"), { target: { value: "最初" } });
        view.setSnapshot({ ...current, from: full.length - 3, to: full.length });
        fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" }));
        fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" }));
        const list = screen.getByLabelText("追加したテキスト");
        expect(within(list).getAllByRole("listitem")).toHaveLength(3);
        fireEvent.click(within(list).getAllByRole("button", { name: "外す" })[2]);
        fireEvent.change(screen.getByLabelText("編集の許可"), { target: { value: "question" } });
        await send("最初とテキスト2を比較して");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledOnce());
        const request = vi.mocked(generateCodex).mock.calls[0][0];
        expect(request.text).toBe("最初:\n一つ目\n\nテキスト2:\n二つ目");
        expect(request.text).not.toContain("送らない部分");
        expect(request.instruction).toContain("replacementは必ずnull");
    });
    it("未実装ツールを保存しても送信しない", async () => {
        mount();
        await waitFor(() => expect(screen.getByLabelText("ツール")).toBeEnabled());
        fireEvent.change(screen.getByLabelText("指示"), { target: { value: "質問" } });
        fireEvent.change(screen.getByLabelText("ツール"), { target: { value: "claude-cli" } });
        fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: "設定を保存" })).toBeNull());
        expect(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })).toBeDisabled();
        fireEvent.keyDown(screen.getByLabelText("指示"), { key: "Enter", ctrlKey: true });
        expect(generateCodex).not.toHaveBeenCalled();
    });
    it("複数の指定場所編集では範囲外を変える提案を拒否する", () => {
        const original = "前A中B後";
        expect(replacementMatchesTargetRanges(original, "前X中Y後", [{ from: 1, to: 2 }, { from: 3, to: 4 }])).toBe(true);
        expect(replacementMatchesTargetRanges(original, "外A中Y後", [{ from: 1, to: 2 }, { from: 3, to: 4 }])).toBe(false);
        expect(replacementMatchesTargetRanges("aXbYab", "ab", [{ from: 1, to: 2 }, { from: 3, to: 4 }])).toBe(false);
        expect(replacementMatchesTargetRanges("abcde", "aZe", [{ from: 1, to: 2 }, { from: 2, to: 4 }])).toBe(true);
    });
    it("指示の直後にツールとモデルを置き、対象欄はその下、ファイル入力は隠す", async () => {
        mount();
        const prompt = await screen.findByLabelText("指示");
        const tool = screen.getByLabelText("ツール");
        const model = screen.getByLabelText("モデル");
        const scope = screen.getByLabelText("今回の対象");
        expect(screen.getByLabelText("編集の許可").parentElement).toBe(screen.getByRole("button", { name: "停止" }).parentElement);
        expect(prompt.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(tool.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(model.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByLabelText("添付するPNG画像")).toHaveAttribute("hidden");
        expect(screen.getByRole("heading", { name: "会話ログ" })).toBeVisible();
        expect(prompt).toHaveAttribute("rows", "7");
        const separator = screen.getByRole("separator", { name: "会話ログと指示文の高さを変更" });
        fireEvent.keyDown(separator, { key: "ArrowDown" });
        expect(separator).toHaveAttribute("aria-valuenow", "50");
        fireEvent.keyDown(separator, { key: "Home" });
        expect(separator).toHaveAttribute("aria-valuenow", "20");
    });
    it("送信済み対象テキストを履歴に残し、次の取り込みに別の番号を付ける", async () => {
        vi.mocked(generateCodex).mockResolvedValue({ answer: "説明しました", replacement: null });
        mount({ target: { ...snapshot, editMode: "question" } });
        await send("テキスト1を説明して");
        await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue(""));
        expect(screen.getByRole("log")).toHaveTextContent("テキスト1");
        expect(within(screen.getByLabelText("今回の対象")).queryByDisplayValue("テキスト1")).not.toBeInTheDocument();
        expect(vi.mocked(generateCodex).mock.calls[0][0].instruction).toContain("今回の対象: テキスト1");
        fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" }));
        expect(within(screen.getByLabelText("今回の対象")).getByDisplayValue("テキスト2")).toBeVisible();
        await send("テキスト2について");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(2));
        expect(vi.mocked(generateCodex).mock.calls[1][0].history[0].text).toContain("テキスト1");
    });
    it("停止時は送信中表示を解除し下書きと対象を保持する", async () => {
        let resolve!: (reply: CodexReply) => void;
        vi.mocked(generateCodex).mockImplementation(() => new Promise(done => { resolve = done; }));
        mount({ target: { ...snapshot, editMode: "question" } });
        await send("途中で止める");
        expect(screen.getByRole("status")).toHaveTextContent("送信中");
        fireEvent.click(screen.getByRole("button", { name: "停止" }));
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(screen.getByLabelText("指示")).toHaveValue("途中で止める");
        expect(screen.getByDisplayValue("テキスト1")).toBeVisible();
        await act(async () => resolve({ answer: "遅延回答", replacement: null }));
        expect(screen.getByRole("log")).not.toHaveTextContent("遅延回答");
    });
    it("テキストを取り込むと選択範囲だけを許可し、選択を解除すると全体へ戻す", async () => {
        const view = mount();
        fireEvent.click(await screen.findByRole("button", { name: "選択テキストを追加" }));
        expect(screen.getByLabelText("編集の許可")).toHaveValue("selection");
        view.setSnapshot({ ...snapshot, from: 0, to: 0 });
        fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" }));
        expect(screen.getByLabelText("編集の許可")).toHaveValue("document");
        expect(screen.getByRole("option", { name: "指定場所のみ編集" })).toBeInTheDocument();
    });
    it("選択がない時は文書全体を編集対象として表示し送信する", async () => {
        mount();
        expect(await screen.findByText("全文から編集")).toBeVisible();
        await send();
        await waitFor(() => expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: snapshot.content })));
    });
    it("質問モードは選択本文だけを送り、変更案を採用させない", async () => {
        mount({ target: { ...snapshot, editMode: "question" } });
        await send("説明して");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: "未保存", instruction: expect.stringContaining("replacementは必ずnull") })));
        expect(screen.queryByRole("button", { name: "決定" })).not.toBeInTheDocument();
    });
    it("画像の実データと会話内ラベルを対応付けて送る", async () => {
        mount({ target: { ...snapshot, imageSource: "image.png", editMode: "question" } });
        await screen.findByLabelText("指示");
        fireEvent.click(screen.getByRole("button", { name: "現在の画像を追加" }));
        await waitFor(() => expect(screen.getByDisplayValue("画像1")).toBeVisible());
        await send("画像を説明して");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ images: [{ base64: "aW1hZ2U=" }], instruction: expect.stringContaining("1枚目=画像1") })));
        expect(screen.getByRole("log")).toHaveTextContent("画像1");
    });
    it("成功時は指示と対象を入力側から外し、画像を履歴に残す", async () => {
        mount({ target: { ...snapshot, imageSource: "image.png", editMode: "question" } });
        fireEvent.click(await screen.findByRole("button", { name: "現在の画像を追加" }));
        await waitFor(() => expect(screen.getByLabelText("追加した画像")).toBeInTheDocument());
        await send("説明して");
        await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue(""));
        expect(screen.queryByLabelText("追加した画像")).not.toBeInTheDocument();
        expect(screen.getByRole("log")).toHaveTextContent("画像1");
    });
    it("送信失敗時は下書きと対象を保持する", async () => {
        vi.mocked(generateCodex).mockRejectedValue("CLI未導入");
        mount({ target: { ...snapshot, editMode: "selection" } });
        await send();
        await screen.findByRole("alert");
        expect(screen.getByLabelText("指示")).toHaveValue("短くして");
        expect(screen.getByDisplayValue("テキスト1")).toBeVisible();
    });
    it("変更案は採用確認を経て本文へ反映する", async () => {
        const { apply } = mount();
        await send();
        fireEvent.click(await screen.findByRole("button", { name: "決定" }));
        await waitFor(() => expect(apply).toHaveBeenCalledWith({ ...snapshot, from: 0, to: snapshot.content.length }, "短い文章。"));
    });
    it("本文競合時は採用を中止してエラーを表示する", async () => {
        const { apply, setSnapshot } = mount();
        await send();
        await screen.findByRole("button", { name: "決定" });
        setSnapshot({ ...snapshot, content: "変更済み" });
        fireEvent.click(screen.getByRole("button", { name: "決定" }));
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
    it("最大化トグルは会話を初期化せず、状態を親へ通知する", async () => {
        const onToggleMaximized = vi.fn();
        mount({ onToggleMaximized });
        const instruction = await screen.findByLabelText("指示");
        fireEvent.change(instruction, { target: { value: "保持する下書き" } });
        fireEvent.click(screen.getByRole("button", { name: "AIパネルを最大化" }));
        expect(onToggleMaximized).toHaveBeenCalledOnce();
        expect(instruction).toHaveValue("保持する下書き");
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
    it("現在の会話を履歴から削除すると入力を空にし、遅延保存や終了で復活させない", async () => {
        const view = mount();
        fireEvent.change(await screen.findByLabelText("指示"), { target: { value: "削除する下書き" } });
        await waitFor(() => expect(sessionMock.sessions.some(item => item.draft.instruction === "削除する下書き")).toBe(true));
        const deletedId = sessionMock.sessions[0].id;
        fireEvent.click(screen.getByRole("button", { name: /会話履歴/ }));
        fireEvent.click(await screen.findByRole("button", { name: "この会話を削除" }));
        await waitFor(() => expect(sessionMock.sessions.some(item => item.id === deletedId)).toBe(false));
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByLabelText("AI会話履歴")).not.toBeInTheDocument();
        expect(screen.getByLabelText("指示")).toHaveValue("");
        view.unmount();
        await act(async () => {});
        expect(sessionMock.sessions).toEqual([]);
    });
    it("入力した下書きを空に戻しても古い自動保存を残さない", async () => {
        const view = mount();
        const instruction = await screen.findByLabelText("指示");
        await waitFor(() => expect(instruction).not.toBeDisabled());
        fireEvent.change(instruction, { target: { value: "消す予定の入力" } });
        fireEvent.change(instruction, { target: { value: "" } });
        await waitFor(() => expect(sessionMock.sessions).toHaveLength(1));
        expect(sessionMock.sessions[0].draft.instruction).toBe("");
        view.unmount();
        await act(async () => {});
        expect(sessionMock.sessions[0].draft.instruction).toBe("");
    });
    it("保存エラーは最後の入力を空にして保存不要になれば解除する", async () => {
        vi.mocked(upsertCodexSession).mockRejectedValueOnce(new Error("保存領域が不足しています"));
        mount();
        const instruction = await screen.findByLabelText("指示");
        fireEvent.change(instruction, { target: { value: "保存に失敗する下書き" } });
        await screen.findByRole("alert");
        fireEvent.change(instruction, { target: { value: "" } });
        await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });
    it("空にした後に古い保存失敗が届いても警告を表示しない", async () => {
        let rejectSave!: (cause: Error) => void;
        vi.mocked(upsertCodexSession).mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
        mount();
        const instruction = await screen.findByLabelText("指示");
        fireEvent.change(instruction, { target: { value: "遅延保存" } });
        await waitFor(() => expect(vi.mocked(upsertCodexSession)).toHaveBeenCalled());
        fireEvent.change(instruction, { target: { value: "" } });
        await act(async () => rejectSave(new Error("遅れて失敗")));
        await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });
    it("送信後の次の質問は過去画像を新しい添付として登録し直さない", async () => {
        vi.mocked(generateCodex).mockResolvedValue({ answer: "画像を説明しました", replacement: null });
        mount({ target: { ...snapshot, imageSource: "image.png", editMode: "question" } });
        await screen.findByLabelText("追加した画像");
        await send("画像1について");
        await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue(""));
        await send("さきほどの画像の続きです");
        await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(2));
        expect(vi.mocked(generateCodex).mock.calls[1][0].instruction).toContain("今回の添付: なし");
        expect(vi.mocked(generateCodex).mock.calls[1][0].text).toBe("");
        await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue(""));
        expect(screen.queryByLabelText("追加した画像")).not.toBeInTheDocument();
    });
});
