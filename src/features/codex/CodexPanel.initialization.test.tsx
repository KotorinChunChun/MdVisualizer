import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "../../lib/commands";
import { loadCodexSessions } from "./sessions";
import { CodexPanel } from "./CodexPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("./sessions", async original => ({ ...await original<typeof import("./sessions")>(), loadCodexSessions: vi.fn(), upsertCodexSession: vi.fn().mockResolvedValue({ sessions: [], retentionDays: 30 }) }));
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn(), listCodexLogs: vi.fn().mockResolvedValue({ entries: [], limit: 20 }), setCodexLogLimit: vi.fn() }));
vi.mock("./skills", () => ({ useCodexSkills: () => [] }));
vi.mock("./preview", () => ({ CodexMarkdownPreview: () => null, diagramImage: vi.fn() }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(cleanup);

describe("AIパネル初期化中の下書き操作", () => {
  it.each(["settings", "sessions"] as const)("%sが先に完了しても履歴復元まで追加と入力を受け付けず、完了後の対象・画像・指示を保持する", async first => {
    const settings = deferred<Record<string, unknown>>(), sessions = deferred<Awaited<ReturnType<typeof loadCodexSessions>>>();
    vi.mocked(loadSettings).mockReturnValueOnce(settings.promise); vi.mocked(loadCodexSessions).mockReturnValueOnce(sessions.promise);
    render(<CodexPanel open onClose={vi.fn()} documentName="initial.md" documentPath="C:/fixture/initial.md" documentText="選択した本文" available getSnapshot={() => ({ documentId: "initial:1", content: "選択した本文", from: 0, to: 4 })} applyProposal={vi.fn()} />);
    const generate = screen.getByRole("button", { name: "新規画像を生成" });
    const capture = screen.getByRole("button", { name: "選択テキストを追加" });
    const addImage = screen.getByRole("button", { name: "画像ファイルを追加" });
    const fileInput = screen.getByLabelText("添付するPNG画像");
    const expectNotReady = () => {
      // jsdomはinertを再現しないため、初期化中のクリックを実ユーザー操作の証拠にしない。
      expect.soft(screen.getByRole("region", { name: "今回の対象" })).toHaveAttribute("inert");
      [generate, capture, addImage, fileInput, screen.getByLabelText("指示"), screen.getByLabelText("編集の許可"), screen.getByRole("button", { name: "新しい会話を開始" })].forEach(control => expect.soft(control).toBeDisabled());
    };
    expectNotReady();
    await act(async () => { if (first === "settings") settings.resolve({ codex: { enabled: true } }); else sessions.resolve({ sessions: [], retentionDays: 30 }); });
    expectNotReady();
    await act(async () => { if (first === "sessions") settings.resolve({ codex: { enabled: true } }); else sessions.resolve({ sessions: [], retentionDays: 30 }); });
    await waitFor(() => expect(generate).toBeEnabled());
    expect(screen.getByRole("region", { name: "今回の対象" })).not.toHaveAttribute("inert");
    [capture, addImage, fileInput, screen.getByLabelText("指示"), screen.getByLabelText("編集の許可")].forEach(control => expect(control).toBeEnabled());
    fireEvent.click(capture);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
    fireEvent.change(fileInput, { target: { files: [new File([Uint8Array.from(atob(png), character => character.charCodeAt(0))], "initial.png", { type: "image/png" })] } });
    await screen.findByLabelText("画像1の名前");
    fireEvent.click(generate);
    expect(screen.getByLabelText("編集指示")).toHaveValue("指示に従ってPNG画像を生成してください。");
    expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("編集指示"), { target: { value: "利用者が直した指示" } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("編集指示")).toHaveValue("利用者が直した指示");
    expect(screen.getByLabelText("テキスト1の名前")).toHaveValue("テキスト1");
    expect(screen.getByLabelText("追加したテキスト")).toHaveTextContent("選択した");
    expect(screen.getByRole("img", { name: "画像1のサムネイル" })).toHaveAttribute("src", `data:image/png;base64,${png}`);
  });
});
