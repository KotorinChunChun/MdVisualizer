import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexPanel } from "./CodexPanel";
import { cancelCodex, generateCodex, listCodexLogs, setCodexLogLimit } from "./api";
import { loadSettings, saveSettings } from "../../lib/commands";
import type { CodexReply } from "./model";
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn().mockResolvedValue(undefined), listCodexLogs: vi.fn(), setCodexLogLimit: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const settings = { codex: { enabled: true, model: "gpt-5.6-luna" } };
const snapshot = { documentId: "a:1", content: "未保存の文章です。", from: 0, to: 3 };
function mount(apply = vi.fn().mockReturnValue(true)) {
  const result = render(<CodexPanel open onClose={vi.fn()} documentName="test.md" documentText={snapshot.content} available getSnapshot={() => snapshot} applyProposal={apply} />);
  return { ...result, apply };
}
async function send(text = "短くして") {
  await screen.findByLabelText("指示");
  fireEvent.change(screen.getByLabelText("指示"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSettings).mockResolvedValue(settings);
  vi.mocked(saveSettings).mockResolvedValue(settings);
  vi.mocked(generateCodex).mockResolvedValue({ answer: "短縮しました", replacement: "短い文章。" });
  vi.mocked(listCodexLogs).mockResolvedValue({ entries: [], limit: 20 });
  vi.mocked(setCodexLogLimit).mockResolvedValue({ entries: [], limit: 20 });
});
afterEach(cleanup);
describe("Codexパネル", () => {
  it.each(["成功", "本文変更", "停止", "文書切替", "空応答"])("画像添付と自動挿入: %s", async (mode) => {
    const content = "![画像](data:image/png;base64,YQ==)\n\n後続";
    let current = { documentId: "image-doc", content, from: 0, to: 0 };
    const apply = vi.fn().mockReturnValue(true);
    let resolve!: (reply: CodexReply) => void;
    vi.mocked(generateCodex).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<CodexPanel open onClose={vi.fn()} documentName="image.md" documentText={content} available getSnapshot={() => current} applyProposal={apply} imageTarget={{ offset: 0 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "解説・文字起こしを挿入" }));
    await waitFor(() => expect(generateCodex).toHaveBeenCalled());
    expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: "", history: [], image: { base64: "YQ==" } }));
    if (mode === "本文変更") current = { ...current, content: "変更" + content };
    if (mode === "停止") fireEvent.click(screen.getByText("停止"));
    if (mode === "文書切替") view.unmount();
    await act(async () => { resolve({ answer: mode === "空応答" ? "" : "解説\n文字起こし", replacement: null }); });
    if (mode === "成功") expect(apply).toHaveBeenCalledWith(expect.objectContaining({ from: content.indexOf("\n"), to: content.indexOf("\n"), content }), "\n\n```text\n解説\n文字起こし\n```\n");
    else expect(apply).not.toHaveBeenCalled();
  });
  it("未有効時はCLIを呼ばず、明示保存で有効化する", async () => {
    vi.mocked(loadSettings).mockResolvedValue({});
    mount();
    await waitFor(() => expect(screen.getByLabelText("Codex連携を有効にする")).not.toBeDisabled());
    expect(screen.queryByLabelText("指示")).toBeNull();
    expect(generateCodex).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Codex連携を有効にする"));
    fireEvent.click(screen.getByText("連携設定を保存"));
    await screen.findByLabelText("指示");
    expect(saveSettings).toHaveBeenCalledWith(settings);
  });
  it("未保存の全文を送り、採用までエディタを変更しない", async () => {
    const { apply } = mount();
    await send();
    await screen.findByRole("button", { name: "採用" });
    expect(screen.getByRole("dialog", { name: "Codex変更案のプレビュー" })).toBeVisible();
    expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: snapshot.content, history: [] }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("採用"));
    expect(apply).toHaveBeenCalledWith({ ...snapshot, from: 0, to: snapshot.content.length }, "短い文章。");
    expect(saveSettings).not.toHaveBeenCalled();
  });
  it("変更案はパネル内ではなく大きなプレビューで確認できる", async () => {
    mount(); await send(); await screen.findByRole("button", { name: "変更案プレビューを閉じる" });
    fireEvent.click(screen.getByRole("button", { name: "変更案プレビューを閉じる" }));
    expect(screen.queryByRole("dialog", { name: "Codex変更案のプレビュー" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "大きな画面でプレビュー" }));
    expect(screen.getByRole("dialog", { name: "Codex変更案のプレビュー" })).toBeVisible();
  });
  it("直近の通信ログを全画面で送信と受信に分けて表示する", async () => {
    vi.mocked(listCodexLogs).mockResolvedValue({ limit: 20, entries: [{ id: "log-1", createdAt: "2026-09-08T12:00:00Z", model: "gpt-5.6-luna", requestPrompt: "送信本文", responseText: "受信本文", responseRaw: "{\"type\":\"turn.completed\"}", inputTokens: 10, cachedInputTokens: 2, outputTokens: 4 }] });
    mount(); await screen.findByRole("button", { name: "ログ（1）" });
    fireEvent.click(screen.getByRole("button", { name: "ログ（1）" }));
    const dialog = await screen.findByRole("dialog", { name: "Codex通信ログ" });
    expect(dialog).toHaveTextContent("送信リクエスト");
    expect(dialog).toHaveTextContent("送信本文");
    expect(dialog).toHaveTextContent("受信応答");
    expect(dialog).toHaveTextContent("受信本文");
  });
  it("取り込んだ選択範囲のみ送信する", async () => {
    mount(); await screen.findByLabelText("指示");
    fireEvent.click(screen.getByText("選択範囲を取り込む"));
    await send();
    await waitFor(() => expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: "未保存" })));
  });
  it("次の指示へ前の変更案と会話を含める", async () => {
    mount(); await send();
    await screen.findByText("採用");
    await send("もっと短く");
    await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(2));
    const request = vi.mocked(generateCodex).mock.calls[1][0];
    expect(request.history).toHaveLength(2);
    expect(request.history[1].text).toContain("短い文章。");
  });
  it("本文競合時は採用成功にしない", async () => {
    const apply = vi.fn().mockReturnValue(false); mount(apply);
    await send(); await screen.findByText("採用");
    fireEvent.click(screen.getByText("採用"));
    expect(screen.getByRole("alert").textContent).toContain("本文や文書が変わりました");
  });
  it("停止後に届く回答を破棄する", async () => {
    let resolve!: (reply: CodexReply) => void;
    vi.mocked(generateCodex).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { apply } = mount(); await send();
    fireEvent.click(screen.getByText("停止"));
    await act(async () => { resolve({ answer: "遅い回答", replacement: "上書き" }); });
    expect(cancelCodex).toHaveBeenCalled();
    expect(screen.queryByText("採用")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
  it("文書切替などのunmount時に実行を停止する", async () => {
    vi.mocked(generateCodex).mockImplementation(() => new Promise(() => {}));
    const { unmount } = mount(); await send(); unmount();
    expect(cancelCodex).toHaveBeenCalled();
  });
  it("失敗しても指示を保持する", async () => {
    vi.mocked(generateCodex).mockRejectedValue("CLI未導入");
    mount(); await send();
    await screen.findByRole("alert");
    expect(screen.getByLabelText("指示")).toHaveValue("短くして");
    expect(screen.queryByText("採用")).toBeNull();
  });
});
