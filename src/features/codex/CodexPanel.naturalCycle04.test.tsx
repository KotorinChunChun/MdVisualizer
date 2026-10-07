import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexPanel } from "./CodexPanel";
import type { CodexConversation, CodexRetentionResult, CodexSessionStore } from "./sessions";
import type { EditorSnapshot } from "./model";
import { MarkdownEditor, type MarkdownEditorHandle } from "../../components/MarkdownEditor";
import { initialTabsState, tabsReducer } from "../../state/tabsReducer";
import type { MarkdownLoadResult } from "../../types/app";
import n01 from "../../../tests/fixtures/codex-natural-cycle04/N01-delete-selection.json";
import n02 from "../../../tests/fixtures/codex-natural-cycle04/N02-retention-zero-retry.json";
import n03 from "../../../tests/fixtures/codex-natural-cycle04/N03-retention-order.json";
import n06 from "../../../tests/fixtures/codex-natural-cycle04/N06-legacy-response.json";

const data = vi.hoisted(() => ({ sessions: [] as CodexConversation[], retentionDays: 30, deleted: new Set<string>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://fixture/${encodeURIComponent(path)}` }));
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn().mockResolvedValue(undefined), listCodexLogs: vi.fn().mockResolvedValue({ entries: [], limit: 20 }), setCodexLogLimit: vi.fn() }));
vi.mock("../../lib/commands", async original => ({ ...await original<object>(), loadSettings: vi.fn().mockResolvedValue({ codex: { enabled: true, model: "gpt-5.6-luna" } }), saveSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("./skills", () => ({ useCodexSkills: () => [] }));

const snapshot = (): CodexSessionStore => ({ sessions: structuredClone(data.sessions), retentionDays: data.retentionDays });
let deletionGate: Promise<void> | undefined;
let retentionOperation: ((days: number) => Promise<CodexRetentionResult | CodexSessionStore>) | undefined;
const pending = new Set<() => void>();
function deferred<T>(fallback: () => T) {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    const release = () => yes(fallback()); pending.add(release);
    resolve = value => { pending.delete(release); yes(value); };
    reject = error => { pending.delete(release); no(error); };
  });
  return { promise, resolve, reject };
}
function setRetention(days: number) {
  data.retentionDays = days;
  const cutoff = Date.now() - days * 86400000;
  data.sessions = days ? data.sessions.filter(session => Date.parse(session.updatedAt) >= cutoff) : [];
  return snapshot();
}
beforeAll(() => { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect(); });
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(n01.now));
  data.sessions = []; data.retentionDays = 30; data.deleted.clear(); deletionGate = undefined; retentionOperation = undefined;
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === "load_codex_sessions") return snapshot();
    if (command === "upsert_codex_session") {
      const value = structuredClone(args.session) as CodexConversation;
      if (data.retentionDays && !data.deleted.has(value.id) && !data.sessions.some(old => old.id === value.id && old.updatedAt > value.updatedAt)) data.sessions = [value, ...data.sessions.filter(old => old.id !== value.id)];
      return snapshot();
    }
    if (command === "delete_codex_session") {
      await deletionGate;
      data.deleted.add(args.sessionId); data.sessions = data.sessions.filter(value => value.id !== args.sessionId);
      return snapshot();
    }
    if (command === "set_codex_session_retention") return retentionOperation ? retentionOperation(args.retentionDays) : setRetention(args.retentionDays);
    throw new Error(`B04の予定外IPC: ${command}`);
  });
});
afterEach(async () => {
  cleanup(); await act(async () => { for (const release of pending) release(); pending.clear(); await Promise.resolve(); });
  vi.useRealTimers(); vi.restoreAllMocks();
});

function seed(fixture: { store: { retentionDays: number; sessions: unknown[] } }) {
  data.retentionDays = fixture.store.retentionDays; data.sessions = structuredClone(fixture.store.sessions) as CodexConversation[];
}
function host(text: string, selected?: { from: number; to: number }) {
  const path = "C:/b04/document.md";
  const document: MarkdownLoadResult = { path, content: text, kind: "markdown", base_dir: "C:/b04", image_paths: [], encoding: "UTF-8", size_bytes: text.length, modified_at: "", revision: "b04-fixture", source: "local", web_url: null, etag: null };
  let state = tabsReducer(initialTabsState, { type: "OPEN", path });
  state = tabsReducer(state, { type: "LOADED", id: state.activeId!, generation: 1, document });
  const tab = () => state.tabs.find(value => value.id === state.activeId)!;
  const editor = createRef<MarkdownEditorHandle>();
  const apply = vi.fn((base: EditorSnapshot, value: string) => editor.current!.applyProposal(base, value));
  const content = () => <><MarkdownEditor ref={editor} documentId={`${tab().id}:${tab().generation}`} value={tab().draft} dirty={tab().dirty} saving={false} onChange={value => { state = tabsReducer(state, { type: "DRAFT_CHANGED", id: tab().id, content: value }); view.rerender(content()); }} onSave={vi.fn()} /><CodexPanel open onClose={vi.fn()} documentName="document.md" documentPath={path} baseDir="C:/b04" documentText={tab().draft} available getSnapshot={() => editor.current?.snapshot() ?? null} applyProposal={apply} /></>;
  const view = render(content());
  if (selected) act(() => EditorView.findFromDOM(view.container.querySelector<HTMLElement>(".cm-editor")!)!.dispatch({ selection: { anchor: selected.from, head: selected.to } }));
  return { ...view, tab, editor, apply };
}
async function ready() {
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(screen.getByLabelText("ツール")).toBeEnabled());
  // restoreが作る300ms autosaveを先に完了し、後続設定の応答順へ混入させない。
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "upsert_codex_session")).toBe(true));
}
async function history() { await ready(); fireEvent.click(screen.getByRole("button", { name: /会話履歴（/ })); return screen.findByLabelText("AI会話履歴"); }
function choose(dialog: HTMLElement, title: string) { fireEvent.click(within(within(dialog).getByRole("navigation", { name: "保存した会話" })).getByRole("button", { name: new RegExp(title) })); }
function changeDays(dialog: HTMLElement, days: number) { const input = within(dialog).getByLabelText("会話履歴の保持日数"); fireEvent.change(input, { target: { value: String(days) } }); fireEvent.blur(input); return input; }

describe("B04 応答・履歴の新規4境界（外部AI送信なし）", () => {
  it.each(["success", "failure"] as const)("B04-N01 A削除待ちにBをプレビューしてもAの%sがBを消去/誤表示しない", async outcome => {
    seed(n01); data.sessions.reverse(); // 現在会話はB。履歴Aの削除とPanelの現会話削除resetを分離する。
    const view = host(n01.document.content), gate = deferred<void>(() => undefined); deletionGate = gate.promise;
    const dialog = await history(); expect(screen.getByLabelText("指示")).toHaveValue("表示対象Bの下書き");
    choose(dialog, "削除対象A"); fireEvent.click(within(dialog).getByRole("button", { name: "この会話を削除" }));
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "delete_codex_session")).toHaveLength(1));
    choose(dialog, "表示対象B"); expect(within(dialog).getByRole("heading", { name: "表示対象B" })).toBeInTheDocument();
    await act(async () => { if (outcome === "success") gate.resolve(); else gate.reject(new Error("保存先が使えません")); });
    const lateError = within(dialog).queryByRole("alert");
    console.info(JSON.stringify({ id: "B04-N01", outcome, heading: within(dialog).queryByRole("heading")?.textContent ?? null, error: lateError?.textContent ?? null, currentInstruction: (screen.getByLabelText("指示") as HTMLTextAreaElement).value, storedIds: data.sessions.map(value => value.id) }));
    expect.soft(within(dialog).queryByRole("heading", { name: "表示対象B" })).toBeInTheDocument();
    // 通知を隠す方式だけでなく、Aの結果と明示して別会話上で報告する実装も許容する。
    expect.soft(!lateError || lateError.textContent?.includes("削除対象A")).toBe(true);
    expect(view.tab().draft).toBe(n01.document.content); expect(view.apply).not.toHaveBeenCalled();
    expect(data.sessions.some(value => value.id === "b04-B")).toBe(true);
    expect(data.sessions.some(value => value.id === "b04-A")).toBe(outcome === "failure");
    if (outcome === "failure") {
      deletionGate = undefined; choose(dialog, "削除対象A");
      expect(within(dialog).getByRole("alert")).toHaveTextContent("保存先が使えません");
      fireEvent.click(within(dialog).getByRole("button", { name: "この会話を削除" }));
      await waitFor(() => expect(data.sessions.some(value => value.id === "b04-A")).toBe(false));
    }
  });
  it("B04-N02 保持0設定の保存失敗を履歴内で示して入力を保ち同じ0で再試行する", async () => {
    seed(n02); const imageBytes = n02.document.adoptedBase64, view = host(n02.document.content); let attempts = 0;
    retentionOperation = async days => { if (++attempts === 1) throw new Error("保持設定を保存できません"); return setRetention(days); };
    const dialog = await history(), initial = snapshot(); changeDays(dialog, 0);
    await waitFor(() => expect(screen.getAllByRole("alert").some(item => item.textContent?.includes("保持設定を保存できません"))).toBe(true));
    console.info(JSON.stringify({ id: "B04-N02", historyError: within(dialog).queryByRole("alert")?.textContent ?? null, panelError: screen.getAllByRole("alert").map(value => value.textContent), retention: data.retentionDays, storedIds: data.sessions.map(value => value.id), instruction: (screen.getByLabelText("指示") as HTMLTextAreaElement).value }));
    expect.soft(within(dialog).queryByRole("alert")).toHaveTextContent("保持設定を保存できません");
    expect(snapshot()).toEqual(initial); expect(within(dialog).getByLabelText("会話履歴の保持日数")).toHaveValue(0);
    expect(screen.getByLabelText("指示")).toHaveValue("採用済み画像の会話の下書き");
    changeDays(dialog, 0); await waitFor(() => expect(data.retentionDays).toBe(0));
    await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue("")); expect(data.sessions).toEqual([]);
    expect(view.tab().draft).toBe(n02.document.content); expect(imageBytes).toBe(n02.store.sessions[0].attachments[0].base64);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => /candidate|save_markdown|delete_document_asset/.test(command))).toBe(false);
  });
  it("B04-N03 保持20日の古い応答で後続7日の設定と削除済み一覧を戻さない", async () => {
    seed(n03); const view = host("保持設定の順序を検証\n"), oldReply = deferred<CodexSessionStore>(snapshot); let previous: CodexSessionStore | undefined;
    retentionOperation = async days => { const applied = setRetention(days); if (days === 20) { previous = applied; return oldReply.promise; } return applied; };
    const dialog = await history(), input = changeDays(dialog, 20);
    await waitFor(() => expect(previous).toBeDefined());
    if ((input as HTMLInputElement).disabled) { await act(async () => { oldReply.resolve(previous!); }); }
    changeDays(dialog, 7); await waitFor(() => expect(data.retentionDays).toBe(7));
    await waitFor(() => expect(input).toHaveValue(7));
    await act(async () => { oldReply.resolve(previous!); });
    console.info(JSON.stringify({ id: "B04-N03", input: (input as HTMLInputElement).value, storeRetention: data.retentionDays, storedIds: data.sessions.map(value => value.id), visibleTitles: within(within(dialog).getByRole("navigation", { name: "保存した会話" })).getAllByRole("button").map(value => value.querySelector("strong")?.textContent) }));
    expect.soft(input).toHaveValue(7);
    expect.soft(within(within(dialog).getByRole("navigation", { name: "保存した会話" })).queryByRole("button", { name: /15日前の会話/ })).toBeNull();
    expect(data.retentionDays).toBe(7); expect(data.sessions.map(value => value.id)).toEqual(["b04-A"]);
    expect(view.tab().draft).toBe("保持設定の順序を検証\n");
  });
  it.each(["partial-result", "ambiguous-error"] as const)("B04-N02補助 保持0保存後の%sでも旧履歴を残さず処理結果を示す", async outcome => {
    seed(n02); const view = host(n02.document.content);
    retentionOperation = async days => {
      const store = setRetention(days), logCleanupError = "IO error: AI通信記録の形式が不正です。";
      // 部分成功DTOと、応答を失った/旧backendがErrで返した場合のreadbackを分ける。
      if (outcome === "partial-result") return { store, logCleanupError };
      throw new Error(logCleanupError);
    };
    const dialog = await history(); changeDays(dialog, 0);
    await waitFor(() => expect(screen.getAllByRole("alert").some(item => item.textContent?.includes("AI通信記録の形式が不正"))).toBe(true));
    const saved = await invoke<CodexSessionStore>("load_codex_sessions");
    const visibleTitles = within(within(dialog).getByRole("navigation", { name: "保存した会話" })).queryAllByRole("button").map(value => value.querySelector("strong")?.textContent);
    console.info(JSON.stringify({ id: "B04-N02-partial", storeRetention: saved.retentionDays, storedIds: saved.sessions.map(value => value.id), visibleTitles, historyError: within(dialog).queryByRole("alert")?.textContent ?? null, instruction: (screen.getByLabelText("指示") as HTMLTextAreaElement).value }));
    expect(saved.retentionDays).toBe(0); expect(saved.sessions).toEqual([]);
    expect.soft(visibleTitles).toEqual([]);
    expect.soft(screen.getByLabelText("指示")).toHaveValue("");
    expect.soft(within(dialog).queryByRole("alert")).toHaveTextContent("AI通信記録");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(outcome === "partial-result" ? "0日で保存しました" : "0日で保存されています");
    expect(view.tab().draft).toBe(n02.document.content); expect(view.apply).not.toHaveBeenCalled();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => /candidate|save_markdown|delete_document_asset/.test(command))).toBe(false);
    // 同じ0日を再操作すると、後半の掃除だけ回復した応答から正常表示へ戻れる。
    retentionOperation = async days => setRetention(days); changeDays(dialog, 0);
    await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
    expect(screen.getByLabelText("指示")).toHaveValue("");
    expect(within(dialog).getByText("保存された会話はありません。")).toBeInTheDocument();
  });
  it("B04-N02補助 保存とreadbackがともに失敗した場合は未保存と断定せず再操作できる", async () => {
    seed(n02); const view = host(n02.document.content), dialog = await history(), initial = snapshot();
    retentionOperation = async () => { throw new Error("応答を受け取れません"); };
    const fallback = vi.mocked(invoke).getMockImplementation()!;
    let readFailed = true;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "load_codex_sessions" && readFailed) throw new Error("ストアも読めません");
      return fallback(command, args);
    });
    changeDays(dialog, 0);
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("保存状態を確認できません"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("ストアも読めません");
    expect(snapshot()).toEqual(initial); expect(within(dialog).getByLabelText("会話履歴の保持日数")).toHaveValue(0);
    expect(screen.getByLabelText("指示")).toHaveValue("採用済み画像の会話の下書き");
    readFailed = false; retentionOperation = async days => ({ store: setRetention(days) }); changeDays(dialog, 0);
    await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
    expect(data.sessions).toEqual([]); expect(view.tab().draft).toBe(n02.document.content);
  });
  it("B04-N03補助 保持変更中に履歴を閉じて開き直しても二重実行せず別選択を守る", async () => {
    seed(n01); data.sessions.reverse(); host(n01.document.content);
    const gate = deferred<CodexSessionStore>(snapshot);
    retentionOperation = async () => gate.promise;
    let dialog = await history(); changeDays(dialog, 20);
    await waitFor(() => expect(within(dialog).getByLabelText("会話履歴の保持日数")).toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "会話履歴を閉じる" }));
    dialog = await history(); choose(dialog, "削除対象A");
    expect(within(dialog).getByLabelText("会話履歴の保持日数")).toBeDisabled();
    fireEvent.blur(within(dialog).getByLabelText("会話履歴の保持日数"));
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_codex_session_retention")).toHaveLength(1);
    await act(async () => { gate.resolve(setRetention(20)); });
    expect(within(dialog).getByLabelText("会話履歴の保持日数")).toBeEnabled();
    expect(within(dialog).getByRole("heading", { name: "削除対象A" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    retentionOperation = async days => ({ store: setRetention(days) });
    changeDays(dialog, 7); await waitFor(() => expect(data.retentionDays).toBe(7));
  });
  it("B04-N03補助 保持確定前に作られたautosaveの応答が後着しても保存済み0日を戻さない", async () => {
    seed(n02); host(n02.document.content); const dialog = await history();
    fireEvent.click(within(dialog).getByRole("button", { name: "会話履歴を閉じる" }));
    const stale = snapshot(), gate = deferred<CodexSessionStore>(() => stale), fallback = vi.mocked(invoke).getMockImplementation()!;
    let held = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "upsert_codex_session" && !held) { held = true; return gate.promise; }
      return fallback(command, args);
    });
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "保存待ちの下書き" } });
    await waitFor(() => expect(held).toBe(true));
    const reopened = await history(); changeDays(reopened, 0);
    await waitFor(() => expect(data.retentionDays).toBe(0));
    await waitFor(() => expect(screen.getByLabelText("指示")).toHaveValue(""));
    await act(async () => { gate.resolve(stale); });
    expect(within(reopened).getByLabelText("会話履歴の保持日数")).toHaveValue(0);
    expect(within(reopened).getByText("保存された会話はありません。")).toBeInTheDocument();
    expect(screen.getByLabelText("指示")).toHaveValue("");
  });
  it("B04-N03補助 保持0の後に古い削除結果が届いても別会話を一覧へ戻さない", async () => {
    seed(n01); data.sessions.reverse(); host(n01.document.content); const dialog = await history();
    const gate = deferred<CodexSessionStore>(snapshot), fallback = vi.mocked(invoke).getMockImplementation()!;
    let deletedSnapshot: CodexSessionStore | undefined;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "delete_codex_session") { deletedSnapshot = await fallback(command, args) as CodexSessionStore; return gate.promise; }
      return fallback(command, args);
    });
    choose(dialog, "削除対象A"); fireEvent.click(within(dialog).getByRole("button", { name: "この会話を削除" }));
    await waitFor(() => expect(deletedSnapshot?.sessions.map(value => value.id)).toEqual(["b04-B"]));
    changeDays(dialog, 0);
    await waitFor(() => expect(within(dialog).getByText("保存された会話はありません。")).toBeInTheDocument());
    await act(async () => { gate.resolve(deletedSnapshot!); });
    expect(within(dialog).getByText("保存された会話はありません。")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("会話履歴の保持日数")).toHaveValue(0);
    expect(data.sessions).toEqual([]); expect(data.deleted.has("b04-A")).toBe(true);
  });
  it("B04-N06 旧形式の応答を全文差分で確認して取り消し元Markdownだけコピーできる", async () => {
    seed(n06); const view = host(n06.document.content, n06.document), dialog = await history();
    choose(dialog, "旧形式の応答"); fireEvent.click(within(dialog).getByRole("button", { name: "この会話を開く" }));
    await waitFor(() => expect(screen.queryByLabelText("AI会話履歴")).toBeNull());
    const before = view.editor.current!.snapshot(); fireEvent.click(screen.getByRole("button", { name: /^挿入$/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "応答の挿入方法" })).getByRole("button", { name: /^置換$/ }));
    const review = await screen.findByRole("dialog", { name: "AI変更案のプレビュー" });
    expect(within(review).getByRole("note")).toHaveTextContent("全文置換");
    expect(within(review).getByRole("heading", { name: "旧応答" })).toBeInTheDocument(); // 実MarkdownPreviewを通す。
    fireEvent.click(within(review).getByRole("button", { name: "コード差分を表示" }));
    expect(within(review).getByLabelText("変更後を直接編集")).toHaveValue(n06.store.sessions[0].messages[0].text);
    fireEvent.click(within(review).getByRole("button", { name: "変更案の確認を閉じる" }));
    expect(view.editor.current!.snapshot()).toEqual(before); expect(view.tab().dirty).toBe(false); expect(view.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^挿入$/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "応答の挿入方法" })).getByRole("button", { name: /^コピー$/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(n06.store.sessions[0].messages[0].text));
    console.info(JSON.stringify({ id: "B04-N06", metadataAbsent: !Object.prototype.hasOwnProperty.call(n06.store.sessions[0].messages[0], "response"), original: view.tab().draft, dirty: view.tab().dirty, applied: view.apply.mock.calls.length, clipboard: vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] }));
    expect(vi.mocked(invoke).mock.calls.some(([command]) => /candidate|save_markdown/.test(command))).toBe(false);
  });
});
