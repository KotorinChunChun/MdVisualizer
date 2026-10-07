import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexPanel } from "./CodexPanel";
import { resolveOperationTarget, type CodexTarget } from "./scope";
import type { EditorSnapshot } from "./model";
import type { CodexConversation } from "./sessions";

const store = vi.hoisted(() => ({ sessions: [] as CodexConversation[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://fixture/${encodeURIComponent(path)}` }));
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn().mockResolvedValue(undefined), listCodexLogs: vi.fn().mockResolvedValue({ entries: [], limit: 20 }), setCodexLogLimit: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn().mockResolvedValue({ codex: { enabled: true, model: "gpt-5.6-luna" } }), saveSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("./sessions", async original => ({
  ...await original<typeof import("./sessions")>(),
  loadCodexSessions: vi.fn(async () => ({ sessions: store.sessions, retentionDays: 30 })),
  upsertCodexSession: vi.fn(async (session: CodexConversation) => {
    store.sessions = [structuredClone(session), ...store.sessions.filter(item => item.id !== session.id)];
    return { sessions: store.sessions, retentionDays: 30 };
  }),
}));
vi.mock("./imageTranscription", async original => ({ ...await original<typeof import("./imageTranscription")>(), loadTranscriptionImage: vi.fn().mockResolvedValue({ base64: "b3JpZ2luYWw=", mime: "image/png" }) }));
vi.mock("./preview", () => ({ CodexMarkdownPreview: ({ source }: { source: string }) => <pre>{source}</pre>, diagramImage: vi.fn() }));
vi.mock("./skills", () => ({ useCodexSkills: () => [
  { id: "edit-image", prompt: "画像を修正してください。", config: { mode: "selection", inputs: ["image"] } },
] }));

const content = '前\n\n![既存](data:image/png;base64,b3JpZ2luYWw= "説明")\n\n後';
const savedPath = "C:/docs/saved-a.md";
const otherPath = "C:/docs/b.md";
const editedProposal = content.replace("b3JpZ2luYWw=", "bmV3") + "\n差分画面での手編集";
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

// Appと同じタブIDをkeyにする。保存による世代変更ではPanelを再生成しない。
function mountHost() {
  let tabId = "tab-a", activePath = "";
  let current: EditorSnapshot = { documentId: "tab-a:1", content, from: 0, to: 0 };
  const selected: CodexTarget = { ...resolveOperationTarget(content, { offset: content.indexOf("![") })!, documentId: current.documentId, skillId: "edit-image", conversationAction: "new" };
  const saveGate = deferred<string | null>();
  const resolvePath = vi.fn(() => saveGate.promise);
  const apply = vi.fn((base: EditorSnapshot, value: string) => {
    if (base.documentId !== current.documentId || base.content !== current.content) return false;
    current = { ...current, content: value };
    view.rerender(panel());
    return true;
  });
  const panel = () => <CodexPanel key={tabId} open onClose={vi.fn()}
    documentName={activePath ? activePath.split("/").pop()! : "無題-1.md"}
    documentPath={activePath} baseDir={activePath ? "C:/docs" : ""} documentText={current.content}
    available consultationTarget={tabId === "tab-a" ? selected : undefined}
    getSnapshot={() => current} applyProposal={apply} resolveDocumentPath={resolvePath} />;
  const view = render(panel());
  return {
    ...view, apply, resolvePath, saveGate, current: () => current,
    saveSameTab() { activePath = savedPath; current = { ...current, documentId: "tab-a:2" }; view.rerender(panel()); },
    switchTab() {
      tabId = "tab-b"; activePath = otherPath;
      // 本文が同じ別タブでも、所有者が違うことを見落とさない。
      current = { documentId: "tab-b:1", content, from: 0, to: 0 };
      view.rerender(panel());
    },
  };
}
async function openEditedProposal() {
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
  const imageDialog = await screen.findByRole("dialog", { name: "生成画像の差分" });
  fireEvent.click(within(imageDialog).getByRole("button", { name: "置換" }));
  const dialog = await screen.findByRole("dialog", { name: "AI変更案のプレビュー" });
  fireEvent.change(within(dialog).getByLabelText("変更後を直接編集"), { target: { value: editedProposal } });
  fireEvent.click(within(dialog).getByRole("button", { name: "コード差分を表示" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "変更後をコピー" }));
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks(); store.sessions = [];
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "codex_edit_image") return { base64: "bmV3", mediaType: "image/png", filename: "new.png" };
    if (command === "codex_prepare_candidate") return { id: "saved-copy", source: "images/new.png", previewDir: "C:/cache/saved-copy" };
    return undefined;
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(async () => { cleanup(); await act(async () => { await Promise.resolve(); }); });

describe("B01追補 変更後コピーによる無題文書の保存", () => {
  it("同一タブのSave As後は手編集を維持し、新しい文書世代へ基準を接続して決定できる", async () => {
    const host = mountHost();
    const dialog = await openEditedProposal();
    await waitFor(() => expect(host.resolvePath).toHaveBeenCalledOnce());
    expect(host.apply).not.toHaveBeenCalled();
    await act(async () => { host.saveSameTab(); });
    await act(async () => { host.saveGate.resolve(savedPath); });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("codex_finish_candidate", { id: "saved-copy", accepted: true }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(editedProposal.replace("data:image/png;base64,bmV3", "images/new.png"));
    expect(host.current()).toMatchObject({ documentId: "tab-a:2", content });
    expect(within(dialog).getByLabelText("変更後を直接編集")).toHaveValue(editedProposal);
    fireEvent.click(within(dialog).getByRole("button", { name: "決定" }));
    await waitFor(() => expect(host.apply).toHaveBeenCalledWith(expect.objectContaining({ documentId: "tab-a:2", content }), editedProposal));
    expect(host.current().content).toBe(editedProposal);
    expect(invoke).not.toHaveBeenCalledWith("codex_finish_candidate", { id: "saved-copy", accepted: false });
  });

  it("保存待ちに同じ本文の別タブへ切り替えても、旧候補を新タブへ接続・配置・コピーしない", async () => {
    const host = mountHost();
    await openEditedProposal();
    await waitFor(() => expect(host.resolvePath).toHaveBeenCalledOnce());
    await act(async () => { host.switchTab(); });
    await act(async () => { host.saveGate.resolve(savedPath); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByLabelText("ツール")).toBeEnabled());
    expect(screen.queryByRole("dialog", { name: "AI変更案のプレビュー" })).toBeNull();
    expect(host.current()).toMatchObject({ documentId: "tab-b:1", content });
    expect(host.apply).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("codex_prepare_candidate", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("codex_commit_candidate", expect.anything());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
