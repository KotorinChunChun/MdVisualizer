import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, saveSettings } from "../../lib/commands";
import { generateCodex } from "./api";
import { CodexPanel } from "./CodexPanel";
import { CodexImageEdit } from "./CodexImageEdit";
import type { EditorSnapshot } from "./model";
import { loadCodexSessions, type CodexConversation } from "./sessions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("./sessions", async original => ({ ...await original<typeof import("./sessions")>(), loadCodexSessions: vi.fn(), upsertCodexSession: vi.fn().mockResolvedValue({ sessions: [], retentionDays: 30 }) }));
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn().mockResolvedValue(undefined), listCodexLogs: vi.fn().mockResolvedValue({ entries: [], limit: 20 }), setCodexLogLimit: vi.fn() }));
vi.mock("./skills", () => ({ useCodexSkills: () => [] }));
vi.mock("./preview", () => ({ CodexMarkdownPreview: () => null, diagramImage: vi.fn() }));

const snapshot: EditorSnapshot = { documentId: "confirm:1", content: "確認対象の本文", from: 0, to: 4 };
const path = "C:/fixture/confirm.md";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  // 修正前の同期実装はPromiseを読まない。元Promiseの拒否を別の未処理拒否にしない。
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function heldConfirm() {
  const gate = deferred<boolean>();
  // Tauriが注入するwindow.confirmは、DOM型宣言と異なりPromise<boolean>を返す。
  const confirm = vi.spyOn(window, "confirm").mockImplementation(() => gate.promise as unknown as boolean);
  return { ...gate, confirm };
}
function seedOldSession() {
  const time = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const session: CodexConversation = { id: "old-owner", title: "confirm.md", documentId: snapshot.documentId, documentPath: path, createdAt: time, updatedAt: time, lastMessageAt: time, messages: [{ role: "user", text: "以前の質問", attachmentIds: [], timestamp: time }], attachments: [], draft: { instruction: "", targetSnapshot: null, attachmentIds: [], editMode: "question" } };
  vi.mocked(loadCodexSessions).mockResolvedValue({ sessions: [session], retentionDays: 30 });
}
function mount() {
  let current = snapshot;
  const view = render(<CodexPanel open onClose={vi.fn()} documentName="confirm.md" documentPath={path} documentText={current.content} available getSnapshot={() => current} applyProposal={vi.fn()} />);
  return { ...view, setSnapshot(value: EditorSnapshot) { current = value; } };
}
async function request(kind: "text" | "image") {
  await waitFor(() => expect(screen.getByLabelText("指示")).toBeEnabled());
  if (kind === "image") fireEvent.click(screen.getByRole("button", { name: "新規画像を生成" }));
  const input = screen.getByLabelText(kind === "image" ? "編集指示" : "指示");
  fireEvent.change(input, { target: { value: "取り消しても残す指示" } });
  fireEvent.click(screen.getByRole("button", { name: kind === "image" ? "画像編集を依頼" : "送信（Ctrl+Enter）" }));
  return input;
}
function expectNoSend() {
  expect(generateCodex).not.toHaveBeenCalled();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "codex_edit_image")).toHaveLength(0);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: false, tool: "codex-cli" } });
  vi.mocked(saveSettings).mockResolvedValue({});
  vi.mocked(loadCodexSessions).mockResolvedValue({ sessions: [], retentionDays: 30 });
  vi.mocked(generateCodex).mockResolvedValue({ answer: "応答", replacement: null });
  vi.mocked(invoke).mockImplementation(async command => command === "codex_edit_image" ? { base64: "bmV3", mediaType: "image/png", filename: "result.png" } : undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AI送信確認の非同期戻り値", () => {
  for (const stage of ["initial", "aged"] as const) for (const kind of ["text", "image"] as const) {
    // 画像APIは会話historyを送らないため、1時間の履歴確認はtextだけに適用する。
    if (stage === "aged" && kind === "image") continue;
    it.each(["cancel", "reject"] as const)(`${stage}/${kind}: %sでは送信せず下書きを保持し再操作できる`, async outcome => {
      if (stage === "aged") { vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: true } }); seedOldSession(); }
      const gate = heldConfirm(); mount(); const input = await request(kind);
      await waitFor(() => expect(gate.confirm).toHaveBeenCalledTimes(1));
      expect.soft(generateCodex).not.toHaveBeenCalled();
      expect.soft(vi.mocked(invoke).mock.calls.some(([command]) => command === "codex_edit_image")).toBe(false);
      expect.soft(saveSettings).not.toHaveBeenCalled();
      await act(async () => { if (outcome === "cancel") gate.resolve(false); else gate.reject(new Error("確認ダイアログ失敗")); });
      await waitFor(() => expect(input).toBeEnabled());
      expectNoSend(); expect(saveSettings).not.toHaveBeenCalled();
      expect(input).toHaveValue("取り消しても残す指示");
      if (outcome === "reject") expect(screen.getByRole("alert")).toHaveTextContent("確認ダイアログ失敗");
      gate.confirm.mockImplementation(() => Promise.resolve(true) as unknown as boolean);
      fireEvent.click(screen.getByRole("button", { name: kind === "image" ? "画像編集を依頼" : "送信（Ctrl+Enter）" }));
      await waitFor(() => kind === "image" ? expect(invoke).toHaveBeenCalledWith("codex_edit_image", expect.anything()) : expect(generateCodex).toHaveBeenCalledTimes(1));
    });
  }
  it("単発の画像送信は古い会話でも履歴再送の確認を追加しない", async () => {
    vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: true } }); seedOldSession();
    const confirm = vi.spyOn(window, "confirm"); mount(); await request("image");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("codex_edit_image", expect.anything()));
    expect(confirm).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    const calls = vi.mocked(invoke).mock.calls.filter(([command]) => command === "codex_edit_image");
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as { request: object }).request).not.toHaveProperty("history");
  });
  for (const stage of ["initial", "aged"] as const) {
    it(`${stage}: 確認中に会話を変更した後の承認は古い依頼を送信しない`, async () => {
      if (stage === "aged") { vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: true } }); seedOldSession(); }
      const gate = heldConfirm(); mount(); await request("text");
      await waitFor(() => expect(gate.confirm).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole("button", { name: "新しい会話を開始" }));
      await act(async () => { gate.resolve(true); });
      await waitFor(() => expect(screen.getByLabelText("指示")).toBeEnabled());
      expectNoSend(); expect(screen.getByLabelText("指示")).toHaveValue("");
    });
    it(`${stage}: 確認中に本文が変わった後の承認は古い対象を送信しない`, async () => {
      if (stage === "aged") { vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: true } }); seedOldSession(); }
      const gate = heldConfirm(); const view = mount(); await request("text");
      await waitFor(() => expect(gate.confirm).toHaveBeenCalledTimes(1));
      view.setSnapshot({ ...snapshot, content: "確認中に利用者が直した本文" });
      await act(async () => { gate.resolve(true); });
      await waitFor(() => expect(screen.getByLabelText("指示")).toBeEnabled());
      expectNoSend(); expect(screen.getByLabelText("指示")).toHaveValue("取り消しても残す指示");
    });
  }
  it("初回同意中の重複ショートカットは確認・設定保存・送信が各1回になる", async () => {
    const gate = heldConfirm(); mount(); const input = await request("text");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(gate.confirm).toHaveBeenCalledTimes(1));
    expect.soft(generateCodex).not.toHaveBeenCalled();
    await act(async () => { gate.resolve(true); });
    await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
  it("画像の初回同意中に会話を変更すると古い画像依頼を送信しない", async () => {
    const gate = heldConfirm(); mount(); await request("image");
    await waitFor(() => expect(gate.confirm).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "新しい会話を開始" }));
    await act(async () => { gate.resolve(true); });
    await waitFor(() => expect(screen.getByLabelText("編集指示")).toBeEnabled());
    expectNoSend(); expect(screen.getByLabelText("編集指示")).toHaveValue("");
  });
  it("確認が失敗しても待機中に開いた別会話にはエラーを転記しない", async () => {
    const gate = heldConfirm(); mount(); await request("text");
    await waitFor(() => expect(gate.confirm).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "新しい会話を開始" }));
    await act(async () => { gate.reject(new Error("旧会話の確認失敗")); });
    await waitFor(() => expect(screen.getByLabelText("指示")).toBeEnabled());
    expectNoSend(); expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("独立した画像編集の同意待ち", () => {
  const imageProps = { documentPath: path, source: "original.png", originalBase64: "b2xk", initialInstruction: "画像を編集", onReferenceChange: vi.fn() };
  it("同意要求の拒否例外を表示して送信せず、指示を保持する", async () => {
    const authorize = vi.fn().mockRejectedValue(new Error("画像同意が失敗"));
    render(<CodexImageEdit {...imageProps} onRequestAuthorization={authorize} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("画像同意が失敗");
    expectNoSend(); expect(screen.getByLabelText("編集指示")).toHaveValue("画像を編集");
    expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeEnabled();
  });
  it("同意待ち中に保存先文書が変わると古い画像を送信しない", async () => {
    const gate = deferred<boolean>(); const authorize = vi.fn(() => gate.promise);
    const view = render(<CodexImageEdit {...imageProps} onRequestAuthorization={authorize} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    view.rerender(<CodexImageEdit {...imageProps} documentPath="C:/other/document.md" onRequestAuthorization={authorize} />);
    await act(async () => { gate.resolve(true); });
    expectNoSend();
  });
  it("同意待ち中の重複クリックは承認要求と画像送信が各1回になる", async () => {
    const gate = deferred<boolean>(); const authorize = vi.fn(() => gate.promise);
    render(<CodexImageEdit {...imageProps} onRequestAuthorization={authorize} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    fireEvent.keyDown(screen.getByLabelText("編集指示"), { key: "Enter", ctrlKey: true });
    expect.soft(authorize).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(true); });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "codex_edit_image")).toHaveLength(1);
  });
  it("別画像へ切り替えた後は新しい同意で再操作でき、古い承認では送らない", async () => {
    const old = deferred<boolean>(), next = deferred<boolean>();
    const authorize = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const view = render(<CodexImageEdit {...imageProps} onRequestAuthorization={authorize} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    view.rerender(<CodexImageEdit {...imageProps} source="next.png" onRequestAuthorization={authorize} />);
    expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    await act(async () => { old.resolve(true); });
    expectNoSend(); expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeDisabled();
    await act(async () => { next.resolve(true); });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "codex_edit_image")).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("codex_edit_image", expect.objectContaining({ request: expect.objectContaining({ source: "next.png" }) }));
  });
  it("同意待ち中にhostが無効化した場合は送信せず、再有効化後に依頼できる", async () => {
    const gate = deferred<boolean>(); const authorize = vi.fn(() => gate.promise);
    const view = render(<CodexImageEdit {...imageProps} onRequestAuthorization={authorize} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    view.rerender(<CodexImageEdit {...imageProps} disabled onRequestAuthorization={authorize} />);
    await act(async () => { gate.resolve(true); });
    expectNoSend();
    view.rerender(<CodexImageEdit {...imageProps} onRequestAuthorization={authorize} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("codex_edit_image", expect.anything()));
  });
  it("送信中の対象切替は旧依頼を止め、新対象で再送でき遅い旧応答を採用しない", async () => {
    const old = deferred<unknown>(), next = deferred<unknown>(); const generated = vi.fn();
    vi.mocked(invoke).mockImplementation((command, args) => command === "codex_edit_image"
      ? ((args as { request: { source: string } }).request.source === "original.png" ? old.promise : next.promise)
      : Promise.resolve(undefined));
    const view = render(<CodexImageEdit {...imageProps} onGenerated={generated} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    view.rerender(<CodexImageEdit {...imageProps} source="next.png" onGenerated={generated} />);
    expect(invoke).toHaveBeenCalledWith("codex_cancel_image", expect.anything());
    expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    await act(async () => { old.resolve({ base64: "old", mediaType: "image/png", filename: "old.png" }); });
    expect(generated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeDisabled();
    await act(async () => { next.resolve({ base64: "next", mediaType: "image/png", filename: "next.png" }); });
    expect(generated).toHaveBeenCalledTimes(1);
    expect(generated).toHaveBeenCalledWith("画像を編集", expect.objectContaining({ filename: "next.png" }), expect.any(String));
  });
});
