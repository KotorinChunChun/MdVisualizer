import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexPanel } from "./CodexPanel";
import { generateCodex } from "./api";
import type { CodexConversation } from "./sessions";
import type { EditorSnapshot } from "./model";
import type { CodexTarget } from "./scope";
import { MarkdownEditor, type MarkdownEditorHandle } from "../../components/MarkdownEditor";
import { initialTabsState, tabsReducer, type TabsAction } from "../../state/tabsReducer";
import type { MarkdownLoadResult } from "../../types/app";
import { saveUntitledDocument } from "../../lib/untitledDocument";

const store = vi.hoisted(() => ({ sessions: [] as CodexConversation[], retention: 30, deleted: new Set<string>(), failSave: false, saveGate: undefined as Promise<void> | undefined }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://fixture/${encodeURIComponent(path)}` }));
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn().mockResolvedValue(undefined), listCodexLogs: vi.fn().mockResolvedValue({ entries: [], limit: 20 }), setCodexLogLimit: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn().mockResolvedValue({ codex: { enabled: true, model: "gpt-5.6-luna" } }), saveSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("./skills", () => ({ useCodexSkills: () => [] }));
// UI表示の画像decodeはjsdomでは判定しない。R01のnative手順を別途実行する。
vi.mock("./preview", () => ({ CodexMarkdownPreview: ({ source, baseDir, stagedAssetPreviews }: { source: string; baseDir?: string; stagedAssetPreviews?: Record<string, string> }) => <pre data-testid="b02-preview" data-base-dir={baseDir} data-staged={JSON.stringify(stagedAssetPreviews ?? {})}>{source}</pre>, diagramImage: vi.fn() }));

const pathA = "C:/b02/A/document.md", pathB = "C:/b02/B/document.md";
const original = "先頭\n対象\n末尾";
const imageA = "iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAYAAADktbcKAAACh0lEQVR4nO3UMQGAQADDQMSw4l8JPt4ByMjQG27v0lzv/XzApqseAHQEAIYJAAwTABgmADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJAAwTABgmADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJALlzDhEBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLPsBoKYffazeRMkAAAAASUVORK5CYII=", imageB = "iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAYAAADktbcKAAACh0lEQVR4nO3UMQGAQADDQMSgBf8CEPEOQEaG3nB7l+a6n/cDNl31AKAjADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJAAwTABgmADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJAAwTABgmADBMAMidc4gIALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYNkPPAGN0eq3q3MAAAAASUVORK5CYII=";
const cloneStore = () => ({ sessions: structuredClone(store.sessions), retentionDays: store.retention });
const doc = (path: string, content: string): MarkdownLoadResult => ({ path, content, kind: "markdown", base_dir: path.slice(0, path.lastIndexOf("/")), image_paths: [], encoding: "UTF-8", size_bytes: content.length, modified_at: "", revision: `fixture:${content}`, source: "local", web_url: null, etag: null });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function session(path = pathA, content = original, count = 1, id = "b02-owner"): CodexConversation {
  const now = new Date().toISOString();
  return { id, title: id, documentId: "tab-1:1", documentPath: path, createdAt: now, updatedAt: now, lastMessageAt: now,
    attachments: Array.from({ length: count }, (_, i) => ({ id: `image-${i}`, label: `候補${i ? "B" : "A"}`, base64: i ? imageB : imageA, mime: "image/png", name: `${i ? "B" : "A"}.png`, addedAt: now })),
    messages: Array.from({ length: count }, (_, i) => ({ role: "assistant" as const, text: `候補${i ? "B" : "A"}`, timestamp: now, attachmentIds: [`image-${i}`], response: { requestId: `${id}-${i}`, target: { documentId: "tab-1:1", content, from: 0, to: content.length }, markdown: "", image: { source: "", status: "pending" as const, afterAttachmentId: `image-${i}` } } })),
    draft: { instruction: "", editMode: "question", attachmentIds: [], targetSnapshot: null } };
}
function imageResponse(index = 0, owner = "b02-owner") { return store.sessions.find(item => item.id === owner)?.messages[index]?.response; }

type Plan = { source: string; parent: string; bytes: string; committed: boolean };
let plans: Map<string, Plan>, files: Map<string, string>, denied: Set<string>, serial: number;
let prepareGate: Promise<void> | undefined, clipboardValue: string;
beforeAll(() => { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect(); });
beforeEach(() => {
  vi.clearAllMocks(); store.sessions = []; store.retention = 30; store.deleted.clear(); store.failSave = false; store.saveGate = undefined;
  plans = new Map(); files = new Map(); denied = new Set(); serial = 0; prepareGate = undefined; clipboardValue = "以前のコピー";
  vi.mocked(generateCodex).mockResolvedValue({ answer: "回答", replacement: null });
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === "load_codex_sessions") return cloneStore();
    if (command === "upsert_codex_session") {
      const value = structuredClone(args.session) as CodexConversation;
      await store.saveGate;
      if (store.failSave) throw new Error("履歴領域へ保存できません");
      // Rust merge_sessionの保持0・墓標・古い保存の抑止を境界契約として再現する。
      if (store.retention && !store.deleted.has(value.id) && !store.sessions.some(old => old.id === value.id && old.updatedAt > value.updatedAt)) store.sessions = [value, ...store.sessions.filter(old => old.id !== value.id)];
      return cloneStore();
    }
    if (command === "delete_codex_session") { store.deleted.add(args.sessionId); store.sessions = store.sessions.filter(item => item.id !== args.sessionId); return cloneStore(); }
    if (command === "set_codex_session_retention") { store.retention = args.retentionDays; if (!store.retention) store.sessions = []; return cloneStore(); }
    if (command === "codex_edit_image") return { base64: serial++ ? imageB : imageA, mediaType: "image/png", filename: "generated.png" };
    if (command === "codex_prepare_candidate") {
      await prepareGate;
      const id = `plan-${++serial}`, source = `image/${id}.png`, parent = args.request.documentPath.slice(0, args.request.documentPath.lastIndexOf("/"));
      plans.set(id, { source, parent, bytes: args.request.base64, committed: false });
      return { id, source, previewDir: `C:/cache/${id}` };
    }
    if (command === "codex_commit_candidate") {
      const plan = plans.get(args.id); if (!plan) throw new Error("候補がありません");
      if (plan.committed) return;
      if (denied.has(plan.parent)) throw new Error("配置先に書き込めません");
      const file = `${plan.parent}/${plan.source}`;
      if (files.has(file)) throw new Error("画像名が既に使用されています。差分確認を開き直してください。");
      files.set(file, plan.bytes); plan.committed = true; return;
    }
    if (command === "codex_validate_candidate_file") {
      const { documentPath, source, base64 } = args.request;
      const file = `${documentPath.slice(0, documentPath.lastIndexOf("/"))}/${source}`;
      if (files.get(file) !== base64) throw new Error("配置画像が削除または変更されています。差分を開き直してください。");
      return;
    }
    if (command === "codex_finish_candidate") {
      const plan = plans.get(args.id); if (!plan) throw new Error("候補がありません");
      const file = `${plan.parent}/${plan.source}`;
      if (!args.accepted && plan.committed) {
        if (files.get(file) !== plan.bytes) throw new Error("採用画像が外部で変更されたため自動削除できません。");
        files.delete(file);
      }
      plans.delete(args.id); return;
    }
    return undefined;
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async (text: string) => { clipboardValue = text; }) } });
});
afterEach(async () => { cleanup(); await act(async () => { await Promise.resolve(); }); });

// Panel・CodeMirror・tabsReducer・初回保存helperは実装を使用。MD/画像/履歴/clipboardのI/Oだけを境界化する。
function host(initialContent = original, untitled = false) {
  let state = tabsReducer(initialTabsState, untitled ? { type: "NEW_MARKDOWN" } : { type: "OPEN", path: pathA });
  if (!untitled) state = tabsReducer(state, { type: "LOADED", id: state.activeId!, generation: 1, document: doc(pathA, initialContent) });
  else state = tabsReducer(state, { type: "DRAFT_CHANGED", id: state.activeId!, content: initialContent });
  const disk = new Map([[pathA, initialContent]]), editor = createRef<MarkdownEditorHandle>();
  let panelOpen = true, failDocumentSave = false, selectedSavePath = pathA;
  let consultationTarget: CodexTarget | undefined;
  let resolveGate: Promise<string | null> | undefined;
  const tab = () => state.tabs.find(item => item.id === state.activeId)!;
  const dispatch = (action: TabsAction) => { state = tabsReducer(state, action); view.rerender(content()); };
  const snapshot = () => editor.current?.snapshot() ?? null;
  const apply = vi.fn((base: EditorSnapshot, value: string) => editor.current!.applyProposal(base, value));
  const save = async (path = tab().path) => {
    const owner = tab(); dispatch({ type: "SAVE_STARTED", id: owner.id });
    if (failDocumentSave) { dispatch({ type: "SAVE_FAILED", id: owner.id, error: "文書を保存できません" }); return false; }
    disk.set(path, owner.draft); dispatch({ type: "SAVED", id: owner.id, document: doc(path, owner.draft) }); return true;
  };
  const resolvePath = vi.fn(async () => {
    const captured = tab();
    if (resolveGate) return resolveGate;
    if (captured.untitled) {
      const result = await saveUntitledDocument({ defaultPath: captured.path, content: captured.draft, openDocumentPaths: state.tabs.filter(item => item.id !== captured.id && !item.untitled).map(item => item.path) }, {
        choosePath: async () => selectedSavePath,
        createDocument: async (path, text) => { if (failDocumentSave) throw new Error("文書を保存できません"); disk.set(path, text); return doc(path, text); },
      });
      if (result.status === "cancelled") return null;
      dispatch({ type: "SAVED", id: captured.id, document: result.document }); return result.path;
    }
    if (!disk.has(captured.path)) throw new Error("Markdownの保存先を確認できません。");
    return captured.path;
  });
  const content = () => <><MarkdownEditor ref={editor} documentId={`${tab().id}:${tab().generation}`} value={tab().draft} dirty={tab().dirty} saving={tab().saving} onChange={value => dispatch({ type: "DRAFT_CHANGED", id: tab().id, content: value })} onSave={() => void save()} />{panelOpen && <CodexPanel key={tab().id} open onClose={() => { panelOpen = false; view.rerender(content()); }} documentName="同じ名前.md" documentPath={tab().untitled ? "" : tab().path} baseDir={tab().document?.base_dir} documentText={tab().draft} available consultationTarget={consultationTarget} getSnapshot={snapshot} applyProposal={apply} resolveDocumentPath={resolvePath} />}</>;
  const view = render(content());
  const editorView = () => EditorView.findFromDOM(view.container.querySelector<HTMLElement>(".cm-editor")!)!;
  return { ...view, tab, snapshot, apply, disk, editor, resolvePath,
    save, setSaveFailure(value: boolean) { failDocumentSave = value; }, setSavePath(path: string) { selectedSavePath = path; }, setResolveGate(value?: Promise<string | null>) { resolveGate = value; },
    openPanel() { panelOpen = true; view.rerender(content()); },
    addTarget() { const current = snapshot()!; consultationTarget = { ...current, from: 0, to: current.content.length, conversationAction: "add", requestId: crypto.randomUUID() }; view.rerender(content()); },
    select(from: number, to = from) { act(() => editorView().dispatch({ selection: { anchor: from, head: to } })); },
    edit(value: string) { act(() => dispatch({ type: "DRAFT_CHANGED", id: tab().id, content: value })); },
    undo() { act(() => { expect(editor.current!.undo()).toBe(true); }); },
    addTab(content = initialContent, untitled = true) { act(() => { dispatch(untitled ? { type: "NEW_MARKDOWN" } : { type: "OPEN", path: pathB }); if (!untitled) dispatch({ type: "LOADED", id: tab().id, generation: tab().generation, document: doc(pathB, content) }); else dispatch({ type: "DRAFT_CHANGED", id: tab().id, content }); }); return tab().id; },
    activate(id: string) { act(() => dispatch({ type: "ACTIVATE", id })); },
    savedAs(path: string) { act(() => { disk.set(path, tab().draft); dispatch({ type: "SAVED", id: tab().id, document: doc(path, tab().draft) }); }); },
  };
}
async function ready() { await act(async () => { await Promise.resolve(); }); await waitFor(() => expect(screen.getByLabelText("ツール")).toBeEnabled()); }
async function generate() {
  await ready(); const button = screen.getByRole("button", { name: "新規画像を生成" });
  if (button.getAttribute("aria-pressed") !== "true") fireEvent.click(button);
  fireEvent.change(screen.getByLabelText("編集指示"), { target: { value: "識別できる候補を生成" } });
  fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
  return screen.findByRole("dialog", { name: "生成画像の差分" });
}
async function openImage(index = 0) { await ready(); fireEvent.click(screen.getAllByRole("button", { name: "画像差分を確認" })[index]); return screen.findByRole("dialog", { name: "生成画像の差分" }); }
function closeImage() { fireEvent.click(within(screen.getByRole("dialog", { name: "生成画像の差分" })).getByRole("button", { name: "閉じる" })); }
async function code(action = "後に挿入") { fireEvent.click(within(screen.getByRole("dialog", { name: "生成画像の差分" })).getByRole("button", { name: action })); return screen.findByRole("dialog", { name: "AI変更案のプレビュー" }); }
async function accept(dialog: HTMLElement) { fireEvent.click(within(dialog).getByRole("button", { name: "決定" })); await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI変更案のプレビュー" })).toBeNull()); }
async function copyAfter(dialog: HTMLElement) { const toggle = within(dialog).queryByRole("button", { name: "コード差分を表示" }); if (toggle) fireEvent.click(toggle); fireEvent.click(within(dialog).getByRole("button", { name: "変更後をコピー" })); await waitFor(() => expect(within(dialog).getByRole("button", { name: "変更後をコピー" })).toBeEnabled()); }
async function history() { fireEvent.click(screen.getByRole("button", { name: /会話履歴（/ })); return screen.findByLabelText("AI会話履歴"); }
async function loadHistory(id: string) {
  await ready();
  const dialog = await history();
  const ordered = [...store.sessions].sort((left, right) => Date.parse(right.lastMessageAt ?? right.updatedAt) - Date.parse(left.lastMessageAt ?? left.updatedAt));
  const index = ordered.findIndex(item => item.id === id); expect(index).toBeGreaterThanOrEqual(0);
  fireEvent.click(within(within(dialog).getByRole("navigation", { name: "保存した会話" })).getAllByRole("button")[index]);
  fireEvent.click(within(dialog).getByRole("button", { name: "この会話を開く" })); await waitFor(() => expect(screen.queryByLabelText("AI会話履歴")).toBeNull());
}
async function ask() { await ready(); fireEvent.change(screen.getByLabelText("編集の許可"), { target: { value: "question" } }); fireEvent.change(screen.getByLabelText("指示"), { target: { value: "回答してください" } }); fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })); await screen.findByRole("button", { name: "挿入" }); }
async function insertText(action: string) { fireEvent.click(screen.getByRole("button", { name: "挿入" })); fireEvent.click(within(screen.getByRole("group", { name: "応答の挿入方法" })).getByRole("button", { name: action })); return screen.findByRole("dialog", { name: "AI変更案のプレビュー" }); }
const alertIncludes = async (text: string) => waitFor(() => expect(screen.getAllByRole("alert").some(item => item.textContent?.includes(text))).toBe(true));

describe("B02 AI応答・履歴・保存の連続操作", () => {
  it("B02-R01 2候補の古いAだけを比較・採用しBを配置しない（画像decodeはnative別証跡）", async () => {
    const h = host("![既存](existing.png)\n" + original);
    await generate(); closeImage(); await generate(); closeImage();
    const image = await openImage(0);
    expect(within(image).getByAltText("変更後の画像")).toHaveAttribute("src", `data:image/png;base64,${imageA}`);
    const review = await code();
    expect(within(review).getAllByTestId("b02-preview").some(item => item.dataset.baseDir === "C:/b02/A" && item.textContent?.includes("existing.png"))).toBe(true);
    await accept(review);
    expect([...files.values()]).toEqual([imageA]); expect(h.tab().draft).toContain([...files.keys()][0].replace("C:/b02/A/", ""));
    await waitFor(() => expect(store.sessions.some(s => s.messages.filter(m => m.response?.image?.status === "adopted").length === 1 && s.messages.some(m => m.response?.image?.status === "pending"))).toBe(true));
  });
  it("B02-R06補助 別の無題文書から同内容Aの履歴を明示的に開いてもAの提案を適用しない", async () => {
    const h = host(original, true); await generate(); closeImage();
    await waitFor(() => expect(store.sessions.some(item => item.messages.length)).toBe(true));
    const owner = store.sessions.find(item => item.messages.length)!;
    h.addTab(); await loadHistory(owner.id); await openImage();
    fireEvent.click(within(screen.getByRole("dialog", { name: "生成画像の差分" })).getByRole("button", { name: "後に挿入" }));
    await alertIncludes("この応答の対象文書を開いてください");
    expect(h.resolvePath).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled(); expect(files.size).toBe(0); expect(h.tab().untitled).toBe(true);
  });
  it("B02-R06補助 Aへ戻るとAの会話を再開しBの候補を持ち込まない", async () => {
    const h = host(original, true), aId = h.tab().id; await generate(); closeImage();
    await waitFor(() => expect(store.sessions.some(item => item.messages.length)).toBe(true));
    const ownerA = store.sessions.find(item => item.messages.length)!;
    h.addTab(); await generate(); closeImage(); await waitFor(() => expect(store.sessions.filter(item => item.messages.length)).toHaveLength(2));
    h.activate(aId); await ready();
    const dialog = await openImage(); expect(within(dialog).getByAltText("変更後の画像")).toHaveAttribute("src", `data:image/png;base64,${ownerA.attachments[0].base64}`);
  });
  it("B02-R06補助 過去の起動で使った同じtab番号の無題会話を自動復帰しない", async () => {
    store.sessions = [session("", original, 1, "previous-runtime")];
    const h = host(original, true); await ready();
    expect(screen.queryByRole("button", { name: "画像差分を確認" })).toBeNull();
    expect(screen.getByText("ここに会話が表示されます。")).toBeVisible(); expect(h.tab().draft).toBe(original);
  });
  it("B02-R06補助 通常文書の対象追加は他の無題の最新会話ではなく現在のAへ追加する", async () => {
    const h = host(original, true), aId = h.tab().id; await generate(); closeImage();
    await waitFor(() => expect(store.sessions.some(item => item.messages.length)).toBe(true)); const ownerA = store.sessions.find(item => item.messages.length)!;
    h.addTab(); await generate(); closeImage(); await waitFor(() => expect(store.sessions.filter(item => item.messages.length)).toHaveLength(2));
    const ownerB = store.sessions.find(item => item.messages.length && item.id !== ownerA.id)!;
    h.activate(aId); await ready(); h.addTarget();
    await waitFor(() => expect(store.sessions.find(item => item.id === ownerA.id)?.draft.textTargets).toHaveLength(1));
    expect(store.sessions.find(item => item.id === ownerB.id)?.draft.textTargets ?? []).toHaveLength(0);
  });
  it("B02-R02 A採用後に同じ旧本文のBを採用せずAを保持する", async () => {
    store.sessions = [session(pathA, original, 2)]; const h = host();
    await openImage(); await accept(await code()); const saved = h.tab().draft;
    await openImage(1); fireEvent.click(within(screen.getByRole("dialog", { name: "生成画像の差分" })).getByRole("button", { name: "置換" }));
    await alertIncludes("対象の文書が変わりました"); expect(h.tab().draft).toBe(saved); expect([...files.values()]).toEqual([imageA]); expect(h.apply).toHaveBeenCalledOnce();
  });
  it("B02-R03 採用済み画像を残して会話を削除し遅延保存で復活させない", async () => {
    store.sessions = [session(pathA, original, 2)]; const h = host(); await openImage(); await accept(await code()); await act(async () => { await h.save(); });
    const saved = h.disk.get(pathA), retained = [...files]; const dialog = await history();
    fireEvent.click(within(dialog).getByRole("button", { name: "この会話を削除" }));
    await waitFor(() => expect(store.sessions).toHaveLength(0)); fireEvent.click(within(dialog).getByRole("button", { name: "会話履歴を閉じる" }));
    h.unmount(); await act(async () => { await Promise.resolve(); });
    expect(store.deleted.has("b02-owner")).toBe(true); expect(store.sessions).toHaveLength(0); expect([...files]).toEqual(retained); expect(h.disk.get(pathA)).toBe(saved);
  });
  it("B02-R04 保持0のあと遅延保存が返っても採用画像以外の履歴は戻らない", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); await accept(await code());
    const gate = deferred<void>(); store.saveGate = gate.promise;
    const callsBefore = vi.mocked(invoke).mock.calls.length;
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.slice(callsBefore).some(([command, args]) => command === "upsert_codex_session" && (args as { session: CodexConversation }).session.messages.some(message => message.response?.image?.status === "adopted"))).toBe(true));
    const dialog = await history(); const input = within(dialog).getByLabelText("会話履歴の保持日数"); fireEvent.change(input, { target: { value: "0" } }); fireEvent.blur(input);
    await waitFor(() => expect(store.retention).toBe(0)); await act(async () => { gate.resolve(); }); store.saveGate = undefined;
    fireEvent.click(within(dialog).getByRole("button", { name: "会話履歴を閉じる" })); h.unmount(); await act(async () => {});
    expect(store.sessions).toHaveLength(0); expect(files.size).toBe(1); expect(h.tab().draft).toContain("image/plan-");
  });
  it("B02-R05 採用後の履歴だけの保存失敗から下書き追記で復旧する", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); store.failSave = true; await accept(await code()); await alertIncludes("会話履歴を保存できません");
    const adopted = h.tab().draft; store.failSave = false; fireEvent.change(screen.getByLabelText("指示"), { target: { value: "次の質問" } });
    await waitFor(() => expect(store.sessions[0].draft.instruction).toBe("次の質問")); expect(imageResponse()?.image?.status).toBe("adopted"); expect(store.sessions[0].attachments[0].base64).toBe(imageA);
    expect(h.tab().draft).toBe(adopted); expect(files.size).toBe(1); expect(screen.queryByText(/会話履歴を保存できません/)).toBeNull();
  });
  it("B02-R06 同名同内容の無題A/Bを文書IDで区別しAだけ保存して採用する", async () => {
    const h = host(original, true), aId = h.tab().id; await generate(); closeImage();
    await waitFor(() => expect(store.sessions.some(s => s.messages.length)).toBe(true)); const ownerA = store.sessions.find(s => s.messages.length)!;
    const bId = h.addTab(); await generate(); closeImage(); await waitFor(() => expect(store.sessions.filter(s => s.messages.length).length).toBe(2));
    const ownerB = store.sessions.find(s => s.messages.length && s.id !== ownerA.id)!;
    expect.soft(ownerA.documentId).toBe(`${aId}:1`); expect.soft(ownerB.documentId).toBe(`${bId}:1`);
    h.activate(aId); await loadHistory(ownerA.id); await openImage(); await accept(await code());
    expect(h.tab().untitled).toBe(false); expect(h.tab().path).toBe(pathA); h.activate(bId); expect(h.tab().untitled).toBe(true); expect(h.tab().draft).toBe(original);
  });
  it("B02-R07 差分中の別フォルダーSaveAsを拒否し明示コピーは新基準へ配置する", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); const review = await code(); h.savedAs(pathB);
    fireEvent.click(within(review).getByRole("button", { name: "決定" })); await alertIncludes("文書が変わりました");
    expect(h.tab().draft).toBe(original); expect(files.size).toBe(0);
    const oldImage = screen.queryByRole("dialog", { name: "生成画像の差分" }); if (oldImage) closeImage();
    await loadHistory("b02-owner"); const image = await openImage(); fireEvent.click(within(image).getByRole("button", { name: "コピー" }));
    await waitFor(() => expect(clipboardValue).toContain("image/plan-")); expect([...files.keys()].every(path => path.startsWith("C:/b02/B/"))).toBe(true);
  });
  it("B02-R08 保存先待ちに別文書へ切替え遅い結果を無効にしてAへ戻れる", async () => {
    const h = host(original, true), aId = h.tab().id; await generate(); const owner = store.sessions.find(s => s.messages.length);
    const gate = deferred<string | null>(); h.setResolveGate(gate.promise); fireEvent.click(within(screen.getByRole("dialog", { name: "生成画像の差分" })).getByRole("button", { name: "後に挿入" }));
    await waitFor(() => expect(h.resolvePath).toHaveBeenCalled()); const bId = h.addTab(); await act(async () => { gate.resolve(pathA); });
    expect(h.tab().id).toBe(bId); expect(h.tab().draft).toBe(original); expect(files.size).toBe(0); expect(plans.size).toBe(0);
    h.setResolveGate(); h.activate(aId); const old = owner ?? store.sessions.find(s => s.messages.length)!; await loadHistory(old.id); await openImage(); await accept(await code()); expect(h.tab().path).toBe(pathA);
  });
  it("B02-R09 保存済み文書のdirty追記は候補コピーだけでは保存されない", async () => {
    store.sessions = [session()]; const h = host(); h.edit(original + "\n未保存追記"); const image = await openImage(); fireEvent.click(within(image).getByRole("button", { name: "コピー" }));
    await waitFor(() => expect(clipboardValue).toContain("image/plan-")); expect(h.disk.get(pathA)).toBe(original); expect(h.tab().dirty).toBe(true); expect(h.tab().draft).toContain("未保存追記");
    await act(async () => { await h.save(); }); expect(h.disk.get(pathA)).toBe(original + "\n未保存追記"); expect(h.tab().dirty).toBe(false);
  });
  it("B02-R10 通常保存で更新された世代に履歴候補を再接続して採用する", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); closeImage(); await act(async () => { await h.save(); });
    const generation = h.tab().generation; await openImage(); await accept(await code()); expect(h.apply).toHaveBeenCalledWith(expect.objectContaining({ documentId: `${h.tab().id}:${generation}` }), expect.any(String)); expect(files.size).toBe(1);
  });
  it("B02-R11 差分後カーソルをQへ移動しても確定したPへ挿入し実Undoできる", async () => {
    const h = host(); await ask(); h.select(3); const review = await insertText("カーソル位置に挿入"); h.select(original.length); await accept(review);
    expect(h.tab().draft).toBe("先頭\n回答\n対象\n末尾"); h.undo(); expect(h.tab().draft).toBe(original);
  });
  it("B02-R12 競合した提案は本文Undo後に再採用でき成功時のエラーを消す", async () => {
    const h = host(); await ask(); const review = await insertText("後に挿入"); h.edit(original + "\n競合"); fireEvent.click(within(review).getByRole("button", { name: "決定" })); await alertIncludes("生成後に本文や文書が変わりました");
    h.undo(); expect(h.tab().draft).toBe(original); await accept(review); expect(h.tab().draft).toBe(original + "\n回答"); expect(screen.queryByRole("alert")).toBeNull(); expect(generateCodex).toHaveBeenCalledOnce();
  });
  it("B02-R13 複数指定範囲の外側手編集を拒否し外側だけ復元後に採用・Undoする", async () => {
    const h = host("前A中B後"); await ready(); h.select(1, 2); fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" })); h.select(3, 4); fireEvent.click(screen.getByRole("button", { name: "選択テキストを追加" }));
    fireEvent.change(screen.getByLabelText("編集の許可"), { target: { value: "selection" } }); vi.mocked(generateCodex).mockResolvedValueOnce({ answer: "変更", replacement: "前X中Y後" });
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "2か所を変更" } }); fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })); const review = await screen.findByRole("dialog", { name: "AI変更案のプレビュー" });
    fireEvent.change(within(review).getByLabelText("変更後を直接編集"), { target: { value: "外X中Y後" } }); fireEvent.click(within(review).getByRole("button", { name: "決定" })); await alertIncludes("範囲外"); expect(h.tab().draft).toBe("前A中B後");
    fireEvent.change(within(review).getByLabelText("変更後を直接編集"), { target: { value: "前X中Y後" } });
    await accept(review);
    expect(h.tab().draft).toBe("前X中Y後"); h.undo(); expect(h.tab().draft).toBe("前A中B後");
  });
  it("B02-R14 採用後のMD保存失敗でdraftと画像を保持し再保存できる（閉じる取消はnative別証跡）", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); await accept(await code()); const draft = h.tab().draft, retained = [...files]; h.setSaveFailure(true);
    await act(async () => { expect(await h.save()).toBe(false); }); expect(h.tab()).toMatchObject({ draft, dirty: true, saveError: "文書を保存できません" }); expect(h.disk.get(pathA)).toBe(original); expect([...files]).toEqual(retained);
    h.setSaveFailure(false); await act(async () => { expect(await h.save()).toBe(true); }); expect(h.disk.get(pathA)).toBe(draft); expect(h.tab().dirty).toBe(false); expect([...files]).toEqual(retained);
  });
  it("B02-R15 clipboard待ちのunmount後に失敗しても未公開画像だけrollbackする", async () => {
    store.sessions = [session()]; files.set("C:/b02/A/image/copied-before.png", "previous"); const h = host(); const image = await openImage(); const gate = deferred<void>(); vi.mocked(navigator.clipboard.writeText).mockImplementation(() => gate.promise);
    fireEvent.click(within(image).getByRole("button", { name: "コピー" })); await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce()); h.unmount(); await act(async () => { gate.reject(new Error("clipboard失敗")); }); await waitFor(() => expect(plans.size).toBe(0));
    expect([...files]).toEqual([["C:/b02/A/image/copied-before.png", "previous"]]); expect(h.tab().draft).toBe(original); expect(imageResponse()?.image?.adoption).toBeUndefined();
  });
  it("B02-R16 rollback直前の外部更新を保護し主処理と自動削除失敗を両方通知する", async () => {
    store.sessions = [session()]; const h = host(); const image = await openImage(); vi.mocked(navigator.clipboard.writeText).mockImplementation(async () => { const file = [...files.keys()][0]; files.set(file, "external-change"); throw new Error("clipboard失敗"); });
    fireEvent.click(within(image).getByRole("button", { name: "コピー" })); await alertIncludes("clipboard失敗"); expect([...files.values()]).toEqual(["external-change"]); expect(h.tab().draft).toBe(original); expect(clipboardValue).toBe("以前のコピー");
    await alertIncludes("外部で変更されたため自動削除できません");
  });
  it("B02-R17 差分後のファイル名衝突を保護し再確認の別名で再生成せず採用する", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); const review = await code(), first = [...plans.values()][0], collision = `${first.parent}/${first.source}`; files.set(collision, "unrelated-file");
    fireEvent.click(within(review).getByRole("button", { name: "決定" })); await alertIncludes("画像名が既に使用"); expect(h.tab().draft).toBe(original); expect(files.get(collision)).toBe("unrelated-file");
    const next = await code(); await accept(next); expect(files.get(collision)).toBe("unrelated-file"); expect([...files.values()]).toEqual(["unrelated-file", imageA]); expect(h.tab().draft).not.toContain(first.source);
  });
  it("B02-R18 配置書込失敗後に同じ候補からコピーを再試行できる", async () => {
    const h = host(); const image = await generate(); denied.add("C:/b02/A"); fireEvent.click(within(image).getByRole("button", { name: "コピー" })); await alertIncludes("配置先に書き込めません"); expect(clipboardValue).toBe("以前のコピー"); expect(files.size).toBe(0);
    denied.clear(); fireEvent.click(within(image).getByRole("button", { name: "コピー" })); await waitFor(() => expect(clipboardValue).toContain("image/plan-")); expect(files.size).toBe(1); expect(h.tab().draft).toBe(original); expect(vi.mocked(invoke).mock.calls.filter(call => call[0] === "codex_edit_image")).toHaveLength(1);
  });
  it("B02-R19 外部削除後の再コピーを参照先不在のまま成功にしない", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); const review = await code(); await copyAfter(review); expect(files.size).toBe(1); files.clear(); vi.mocked(navigator.clipboard.writeText).mockClear();
    await copyAfter(review); expect(h.tab().draft).toBe(original);
    const copiedAgain = vi.mocked(navigator.clipboard.writeText).mock.calls.length > 0;
    expect(copiedAgain && files.size === 0, "参照が失われた画像のコードを成功として再コピーした").toBe(false);
    if (!copiedAgain) expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });
  it("B02-R19補助 コピー済みの正常画像は再確認して再コピーと採用を続けられる", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); const review = await code(); await copyAfter(review);
    const retained = [...files], source = retained[0][0].replace("C:/b02/A/", "");
    await copyAfter(review); expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
    await accept(review); expect(h.tab().draft).toContain(source); expect([...files]).toEqual(retained);
    const validations = vi.mocked(invoke).mock.calls.filter(call => call[0] === "codex_validate_candidate_file");
    expect(validations).toEqual(Array(2).fill(["codex_validate_candidate_file", { request: { documentPath: pathA, source, base64: imageA } }]));
  });
  it("B02-R19補助 外部変更された画像を保護し再コピーと採用を止め別planで再開する", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); const review = await code(); await copyAfter(review);
    const file = [...files.keys()][0]; files.set(file, imageB); vi.mocked(navigator.clipboard.writeText).mockClear();
    await copyAfter(review); await alertIncludes("配置画像が削除または変更"); expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole("button", { name: "決定" })); await alertIncludes("配置画像が削除または変更");
    expect(h.apply).not.toHaveBeenCalled(); expect(files.get(file)).toBe(imageB);
    const next = await code(); await accept(next); expect(files.get(file)).toBe(imageB); expect([...files.values()]).toEqual([imageB, imageA]); expect(h.tab().draft).not.toContain(file.replace("C:/b02/A/", ""));
  });
  it("B02-R20 基準フォルダー消失の失敗後は明示した新文書からコピーを再操作する", async () => {
    store.sessions = [session()]; const h = host(); await openImage(); const review = await code(); h.disk.delete(pathA); denied.add("C:/b02/A");
    fireEvent.click(within(review).getByRole("button", { name: "決定" })); await alertIncludes("配置先に書き込めません"); expect(h.tab().draft).toBe(original); expect(files.size).toBe(0);
    closeImage(); h.savedAs(pathB); await loadHistory("b02-owner"); const image = await openImage(); fireEvent.click(within(image).getByRole("button", { name: "コピー" })); await waitFor(() => expect(clipboardValue).toContain("image/plan-"));
    expect([...files.keys()].every(file => file.startsWith("C:/b02/B/"))).toBe(true);
  });
});
