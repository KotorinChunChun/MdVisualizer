import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CodexPanel } from "./CodexPanel";
import { generateCodex } from "./api";
import { loadSettings, saveSettings } from "../../lib/commands";
import { loadTranscriptionImage } from "./imageTranscription";
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
vi.mock("./imageTranscription", async original => ({ ...await original<typeof import("./imageTranscription")>(), loadTranscriptionImage: vi.fn().mockRejectedValue(new Error("元画像はありません")) }));
// UI表示の画像decodeはjsdomでは判定しない。R01のnative手順を別途実行する。
vi.mock("./preview", () => ({ CodexMarkdownPreview: ({ source, baseDir, stagedAssetPreviews }: { source: string; baseDir?: string; stagedAssetPreviews?: Record<string, string> }) => <pre data-testid="b03-preview" data-base-dir={baseDir} data-staged={JSON.stringify(stagedAssetPreviews ?? {})}>{source}</pre>, diagramImage: vi.fn() }));

const pathA = "C:/b03/A/document.md", pathB = "C:/b03/B/document.md";
const original = "先頭\n対象\n末尾";
const imageA = "iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAYAAADktbcKAAACh0lEQVR4nO3UMQGAQADDQMSw4l8JPt4ByMjQG27v0lzv/XzApqseAHQEAIYJAAwTABgmADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJAAwTABgmADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJALlzDhEBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLPsBoKYffazeRMkAAAAASUVORK5CYII=", imageB = "iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAYAAADktbcKAAACh0lEQVR4nO3UMQGAQADDQMSgBf8CEPEOQEaG3nB7l+a6n/cDNl31AKAjADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJAAwTABgmADBMAGCYAMAwAYBhAgDDBACGCQAMEwAYJgAwTABgmADAMAGAYQIAwwQAhgkADBMAGCYAMEwAYJgAwDABgGECAMMEAIYJAAwTABgmADBMAMidc4gIALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYJkAkKtPsEwAyNUnWCYA5OoTLBMAcvUJlgkAufoEywSAXH2CZQJArj7BMgEgV59gmQCQq0+wTADI1SdYJgDk6hMsEwBy9QmWCQC5+gTLBIBcfYJlAkCuPsEyASBXn2CZAJCrT7BMAMjVJ1gmAOTqEywTAHL1CZYJALn6BMsEgFx9gmUCQK4+wTIBIFefYNkPPAGN0eq3q3MAAAAASUVORK5CYII=";
const cloneStore = () => ({ sessions: structuredClone(store.sessions), retentionDays: store.retention });
const doc = (path: string, content: string): MarkdownLoadResult => ({ path, content, kind: "markdown", base_dir: path.slice(0, path.lastIndexOf("/")), image_paths: [], encoding: "UTF-8", size_bytes: content.length, modified_at: "", revision: `fixture:${content}`, source: "local", web_url: null, etag: null });
const deferredCleanups = new Set<() => void>();
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    // 途中assert失敗でも未完了のI/Oを次caseへ残さない。cleanupで先にunmountしてから解放する。
    const release = () => yes(undefined as T);
    deferredCleanups.add(release);
    resolve = value => { deferredCleanups.delete(release); yes(value); };
    reject = reason => { deferredCleanups.delete(release); no(reason); };
  });
  return { promise, resolve, reject };
}
function session(path = pathA, content = original, count = 1, id = "b03-owner"): CodexConversation {
  const now = new Date().toISOString();
  return { id, title: id, documentId: "tab-1:1", documentPath: path, createdAt: now, updatedAt: now, lastMessageAt: now,
    attachments: Array.from({ length: count }, (_, i) => ({ id: `image-${i}`, label: `候補${i ? "B" : "A"}`, base64: i ? imageB : imageA, mime: "image/png", name: `${i ? "B" : "A"}.png`, addedAt: now })),
    messages: Array.from({ length: count }, (_, i) => ({ role: "assistant" as const, text: `候補${i ? "B" : "A"}`, timestamp: now, attachmentIds: [`image-${i}`], response: { requestId: `${id}-${i}`, target: { documentId: "tab-1:1", content, from: 0, to: content.length }, markdown: "", image: { source: "", status: "pending" as const, afterAttachmentId: `image-${i}` } } })),
    draft: { instruction: "", editMode: "question", attachmentIds: [], targetSnapshot: null } };
}

type Plan = { source: string; parent: string; bytes: string; committed: boolean };
let plans: Map<string, Plan>, files: Map<string, string>, denied: Set<string>, serial: number;
let prepareGate: Promise<void> | undefined, clipboardValue: string, candidateFolder: string;
beforeAll(() => { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect(); });
beforeEach(() => {
  vi.clearAllMocks(); store.sessions = []; store.retention = 30; store.deleted.clear(); store.failSave = false; store.saveGate = undefined;
  plans = new Map(); files = new Map(); denied = new Set(); serial = 0; prepareGate = undefined; clipboardValue = "以前のコピー"; candidateFolder = "image/";
  vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: true, model: "gpt-5.6-luna" } }); vi.mocked(saveSettings).mockResolvedValue({});
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // clearAllMocksだけでは前caseの未消費mockReturnValueOnceが残る。
  vi.mocked(generateCodex).mockReset().mockResolvedValue({ answer: "回答", replacement: null });
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
      const id = `plan-${++serial}`, source = `${candidateFolder}${id}.png`, parent = args.request.documentPath.slice(0, args.request.documentPath.lastIndexOf("/"));
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
afterEach(async () => {
  cleanup();
  await act(async () => { deferredCleanups.forEach(release => release()); deferredCleanups.clear(); await Promise.resolve(); });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

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
const alertIncludes = async (text: string) => waitFor(() => expect(screen.getAllByRole("alert").some(item => item.textContent?.includes(text))).toBe(true));

function draft(owner = "b03-owner"): CodexConversation { const value = session(pathA, original, 0, owner); value.lastMessageAt = null; return value; }
function pngFile(name = "input.png", base64 = imageA) { return new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name, { type: "image/png" }); }
function addFile(file = pngFile()) { fireEvent.change(screen.getByLabelText("添付するPNG画像"), { target: { files: [file] } }); }
async function submitQuestion(instruction = "質問です") {
  await ready(); fireEvent.change(screen.getByLabelText("編集の許可"), { target: { value: "question" } });
  fireEvent.change(screen.getByLabelText("指示"), { target: { value: instruction } }); fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" }));
}
function heldReaders() {
  const readers: { file: File; finish: (base64: string) => void }[] = [];
  class Reader {
    result: string | null = null; error: Error | null = null; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    readAsDataURL(file: File) { readers.push({ file, finish: base64 => { this.result = `data:image/png;base64,${base64}`; this.onload?.(); } }); }
  }
  vi.stubGlobal("FileReader", Reader); return readers;
}
async function copyImage() {
  const dialog = screen.getByRole("dialog", { name: "生成画像の差分" });
  fireEvent.click(within(dialog).getByRole("button", { name: "コピー" }));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "コピー" })).toBeEnabled());
}

describe("B03 AI応答・読込・再送の新しい操作境界", () => {
  it("B03-N01 コピー済みplanのままSaveAsした後は新基準の画像を確認せず再コピーしない", async () => {
    store.sessions = [session()]; const view = host(); await openImage(); const review = await code(); await copyAfter(review);
    expect(files.size).toBe(1); const oldFiles = new Map(files); const previousClipboardCalls = vi.mocked(navigator.clipboard.writeText).mock.calls.length;
    view.savedAs(pathB); await copyAfter(review);
    const source = /!\[.*?\]\(([^)]+)\)/.exec(clipboardValue)?.[1];
    const copiedAgain = vi.mocked(navigator.clipboard.writeText).mock.calls.length > previousClipboardCalls;
    if (copiedAgain) expect(files.get(`C:/b03/B/${source}`)).toBe(imageA);
    else expect(within(review).getByRole("alert")).toBeInTheDocument();
    for (const [path, bytes] of oldFiles) expect(files.get(path)).toBe(bytes);
    expect(view.tab().draft).toBe(original);
  });
  it("B03-N02 設定変更後に差分を開き直すと新保存先のコードを使い旧コピーを保持する（設定I/Oは境界stub）", async () => {
    store.sessions = [session()]; const view = host(); candidateFolder = ""; await openImage(); let review = await code(); await copyAfter(review);
    const old = new Map(files); fireEvent.click(within(review).getByRole("button", { name: "変更案の確認を閉じる" })); candidateFolder = "image/";
    await openImage(); review = await code(); expect((within(review).getByLabelText("変更後を直接編集") as HTMLTextAreaElement).value).toContain("image/"); await copyAfter(review);
    expect(clipboardValue).toContain("image/"); expect(files.size).toBe(2); for (const [path, bytes] of old) expect(files.get(path)).toBe(bytes); expect(view.tab().draft).toBe(original);
  });
  it("B03-N01補助 未コピーの手編集候補はSaveAs後のコピーと採用を止めて内容を保持する", async () => {
    store.sessions = [session()]; const view = host(); await openImage(); const review = await code();
    const input = within(review).getByLabelText("変更後を直接編集") as HTMLTextAreaElement;
    const edited = input.value + "\n手編集を保持"; fireEvent.change(input, { target: { value: edited } });
    view.savedAs(pathB); await copyAfter(review);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled(); expect(files.size).toBe(0);
    expect(within(review).getByRole("alert")).toHaveTextContent("保存先が変わりました"); expect(input).toHaveValue(edited);
    fireEvent.click(within(review).getByRole("button", { name: "決定" }));
    await waitFor(() => expect(within(review).getByRole("button", { name: "決定" })).toBeEnabled());
    expect(view.apply).not.toHaveBeenCalled(); expect(input).toHaveValue(edited); expect(view.tab().draft).toBe(original);
    fireEvent.click(within(review).getByRole("button", { name: "変更案の確認を閉じる" }));
    await waitFor(() => expect(plans.size).toBe(0)); expect(files.size).toBe(0);
  });
  it("B03-N01補助 コピー済み画像の検証待ちにSaveAsしても再コピーせず旧配置と手編集を保持する", async () => {
    store.sessions = [session()]; const view = host(); await openImage(); const review = await code(); await copyAfter(review);
    const oldFiles = new Map(files), gate = deferred<void>();
    const fallback = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => { if (command === "codex_validate_candidate_file") await gate.promise; return fallback(command, args); });
    const input = within(review).getByLabelText("変更後を直接編集") as HTMLTextAreaElement;
    const edited = input.value + "\n検証待ちの手編集"; fireEvent.change(input, { target: { value: edited } });
    fireEvent.click(within(review).getByRole("button", { name: "変更後をコピー" }));
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "codex_validate_candidate_file")).toBe(true));
    view.savedAs(pathB); await act(async () => { gate.resolve(); });
    await waitFor(() => expect(within(review).getByRole("alert")).toHaveTextContent("保存先が変わりました"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1); expect(input).toHaveValue(edited);
    expect(files).toEqual(oldFiles); expect(view.tab().draft).toBe(original);
  });
  it("B03-N01補助 未公開配置の完了待ちにSaveAsしてもコピーせず閉じたときだけ片付ける", async () => {
    store.sessions = [session()]; const view = host(); await openImage(); const review = await code();
    const gate = deferred<void>(), fallback = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => { const value = await fallback(command, args); if (command === "codex_commit_candidate") await gate.promise; return value; });
    fireEvent.click(within(review).getByRole("button", { name: "コード差分を表示" }));
    fireEvent.click(within(review).getByRole("button", { name: "変更後をコピー" })); await waitFor(() => expect(files.size).toBe(1));
    view.savedAs(pathB); await act(async () => { gate.resolve(); });
    await waitFor(() => expect(within(review).getByRole("alert")).toHaveTextContent("保存先が変わりました"));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled(); expect(view.tab().draft).toBe(original);
    fireEvent.click(within(review).getByRole("button", { name: "変更案の確認を閉じる" }));
    await waitFor(() => expect(files.size).toBe(0)); expect(plans.size).toBe(0);
  });
  it("B03-N01補助 同じWindows保存先の通常表記と拡張表記では再コピーを許可する", async () => {
    store.sessions = [session()]; const view = host(); await openImage(); const review = await code(); await copyAfter(review);
    const oldFiles = new Map(files); view.savedAs("\\\\?\\C:\\b03\\A\\document.md"); await copyAfter(review);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2); expect(files).toEqual(oldFiles); expect(within(review).queryByRole("alert")).toBeNull();
  });
  it("B03-N03 別文書の履歴から本文採用は拒否し明示コピーは現在文書基準へ配置する", async () => {
    store.sessions = [session()]; const view = host(); await ready(); view.addTab(original, false); view.disk.set(pathB, original); await loadHistory("b03-owner"); await openImage();
    fireEvent.click(within(screen.getByRole("dialog", { name: "生成画像の差分" })).getByRole("button", { name: "置換" })); await alertIncludes("対象文書");
    expect(view.apply).not.toHaveBeenCalled(); await copyImage(); expect(clipboardValue).toContain("![]("); expect([...files.keys()].every(path => path.startsWith("C:/b03/B/"))).toBe(true);
    expect(files.size).toBe(1); expect(view.tab().draft).toBe(original);
    await waitFor(() => expect(store.sessions.find(item => item.id === "b03-owner")?.messages[0].response?.image?.adoption?.documentPath).toBe(pathB));
  });
  it("B03-N04 Aのファイル読込待ちにB会話を開始してもAの遅い画像をBへ混在させない", async () => {
    const readers = heldReaders(); host(); await ready(); addFile(pngFile("A.png")); fireEvent.click(screen.getByRole("button", { name: "新しい会話を開始" })); addFile(pngFile("B.png", imageB));
    expect(readers).toHaveLength(2); await act(async () => { readers[1].finish(imageB); }); await screen.findByLabelText("画像1の名前");
    await act(async () => { readers[0].finish(imageA); }); expect(screen.getAllByRole("img", { name: /のサムネイル/ })).toHaveLength(1);
    await submitQuestion(); await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1)); expect(vi.mocked(generateCodex).mock.calls[0][0].images).toEqual([{ base64: imageB }]);
  });
  it("B03-N05 同一PNGの読込が逆順に完了しても未送信添付を二重登録しない", async () => {
    const readers = heldReaders(); host(); await ready(); addFile(); addFile(); expect(readers).toHaveLength(2);
    // FileReaderの各loadは別task。先行loadのmicrotaskを完了させてから次のloadを渡す。
    await act(async () => { readers[1].finish(imageA); }); await act(async () => { readers[0].finish(imageA); }); expect(screen.getAllByRole("img", { name: /のサムネイル/ })).toHaveLength(1);
    await submitQuestion(); await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1)); expect(vi.mocked(generateCodex).mock.calls[0][0].images).toEqual([{ base64: imageA }]);
  });
  it("B03-N06 送信済み画像を再追加して改名しても過去メッセージのラベルを保持する", async () => {
    host(); await ready(); addFile(); await screen.findByLabelText("画像1の名前"); await submitQuestion("最初の画像"); await screen.findByRole("button", { name: "挿入" });
    addFile(); await screen.findByLabelText("画像2の名前"); fireEvent.change(screen.getByLabelText("画像2の名前"), { target: { value: "今回の画像" } }); await submitQuestion("同じ画像を再確認");
    await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(2)); const request = vi.mocked(generateCodex).mock.calls[1][0];
    expect(request.instruction).toContain("今回の添付: 今回の画像"); expect(request.history[0].text).toContain("添付: 画像1"); expect(request.history[0].text).not.toContain("今回の画像");
    expect(request.images?.every(item => item.base64 === imageA)).toBe(true);
  });
  it("B03-N07 初回同意の設定保存失敗では送信せず添付と指示を保持して再送できる", async () => {
    vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: false } }); vi.mocked(saveSettings).mockRejectedValueOnce(new Error("設定保存失敗")); host(); await ready(); addFile(); await screen.findByLabelText("画像1の名前");
    await submitQuestion("保持する指示"); await alertIncludes("設定保存失敗"); expect(generateCodex).not.toHaveBeenCalled(); expect(screen.getByLabelText("指示")).toHaveValue("保持する指示"); expect(screen.getByLabelText("画像1の名前")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })); await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1)); expect(vi.mocked(generateCodex).mock.calls[0][0].images).toEqual([{ base64: imageA }]);
  });
  it("B03-N08 設定保存待ちに新しい会話へ移ると旧指示を送信せず新下書きを保持する", async () => {
    const gate = deferred<Record<string, unknown>>(); vi.mocked(loadSettings).mockResolvedValue({ codex: { enabled: false } }); vi.mocked(saveSettings).mockReturnValueOnce(gate.promise); host(); await submitQuestion("旧指示");
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1)); fireEvent.click(screen.getByRole("button", { name: "新しい会話を開始" }));
    await act(async () => { gate.resolve({}); }); await waitFor(() => expect(screen.getByLabelText("指示")).toBeEnabled()); fireEvent.change(screen.getByLabelText("指示"), { target: { value: "新指示" } });
    expect(generateCodex).not.toHaveBeenCalled(); expect(screen.getByLabelText("指示")).toHaveValue("新指示"); fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" }));
    await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1)); expect(vi.mocked(generateCodex).mock.calls[0][0].instruction).toContain("新指示"); expect(vi.mocked(generateCodex).mock.calls[0][0].instruction).not.toContain("旧指示");
  });
  it("B03-N09 停止したテキスト要求Aの遅い終了が再送Bの送信状態と履歴を変えない", async () => {
    const a = deferred<Awaited<ReturnType<typeof generateCodex>>>(), b = deferred<Awaited<ReturnType<typeof generateCodex>>>(); vi.mocked(generateCodex).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    host(); await submitQuestion("A"); await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled(); fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await submitQuestion("B"); await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(2));
    await act(async () => { a.resolve({ answer: "古いA", replacement: null }); }); expect(screen.getByRole("button", { name: "停止" })).toBeEnabled(); expect(screen.queryByText("古いA")).toBeNull();
    await act(async () => { b.resolve({ answer: "新しいB", replacement: null }); }); expect(screen.getByText("新しいB")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "挿入" })).toHaveLength(1);
  });
  it("B03-N10 停止した画像要求Aの遅い終了が再送Bの候補を置き換えない", async () => {
    const a = deferred<unknown>(), b = deferred<unknown>(); const fallback = vi.mocked(invoke).getMockImplementation()!; let requests = 0;
    vi.mocked(invoke).mockImplementation((command, args) => command === "codex_edit_image" ? (++requests === 1 ? a.promise : b.promise) as any : fallback(command, args));
    host(); await ready(); fireEvent.click(screen.getByRole("button", { name: "新規画像を生成" })); fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" })); await waitFor(() => expect(requests).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "停止" })); fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" })); await waitFor(() => expect(requests).toBe(2));
    await act(async () => { a.resolve({ base64: imageA, mediaType: "image/png", filename: "A.png" }); }); expect(screen.getByRole("button", { name: "停止" })).toBeEnabled(); expect(screen.queryByRole("dialog", { name: "生成画像の差分" })).toBeNull();
    await act(async () => { b.resolve({ base64: imageB, mediaType: "image/png", filename: "B.png" }); }); const dialog = await screen.findByRole("dialog", { name: "生成画像の差分" });
    expect(within(dialog).getByRole("img", { name: "変更後の画像" })).toHaveAttribute("src", `data:image/png;base64,${imageB}`); closeImage(); expect(screen.getAllByRole("button", { name: "画像差分を確認" })).toHaveLength(1);
  });
  it("B03-N11 画像生成失敗後は指示を保持して再送し成功候補だけを履歴へ残す", async () => {
    const fallback = vi.mocked(invoke).getMockImplementation()!; let requests = 0;
    vi.mocked(invoke).mockImplementation((command, args) => command === "codex_edit_image" && ++requests === 1 ? Promise.reject(new Error("画像CLI失敗")) : fallback(command, args));
    host(); await ready(); fireEvent.click(screen.getByRole("button", { name: "新規画像を生成" })); fireEvent.change(screen.getByLabelText("編集指示"), { target: { value: "再送する画像指示" } }); fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    await alertIncludes("画像CLI失敗"); expect(screen.getByLabelText("編集指示")).toHaveValue("再送する画像指示"); fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    await screen.findByRole("dialog", { name: "生成画像の差分" }); closeImage(); expect(screen.queryByText("Error: 画像CLI失敗")).toBeNull(); expect(screen.getAllByRole("button", { name: "画像差分を確認" })).toHaveLength(1);
  });
  it("B03-N12 元ファイルなしでも保存済みの変更前後で候補を再表示する（実再起動は別受入）", async () => {
    const saved = session(); saved.attachments.push({ id: "before", label: "元画像", name: "original.png", base64: imageB, mime: "image/png", addedAt: new Date().toISOString() }); saved.messages[0].response!.image!.beforeAttachmentId = "before"; saved.messages[0].response!.image!.source = "original.png";
    store.sessions = [saved]; let view = host(); await ready(); view.unmount(); await act(async () => { await Promise.resolve(); }); view = host(); const comparison = await openImage();
    expect(within(comparison).getByRole("img", { name: "変更前の画像" })).toHaveAttribute("src", `data:image/png;base64,${imageB}`); expect(within(comparison).getByRole("img", { name: "変更後の画像" })).toHaveAttribute("src", `data:image/png;base64,${imageA}`);
    expect(loadTranscriptionImage).not.toHaveBeenCalled(); const review = await code(); await accept(review); expect([...files.values()]).toEqual([imageA]);
  });
  it("B03-N13 候補画像が欠けた履歴は配置せず失敗を示し正常会話へ戻れる", async () => {
    const broken = session(); broken.attachments = []; store.sessions = [broken, session(pathA, original, 1, "healthy")]; const view = host(); await loadHistory("b03-owner"); await openImage(); await copyImage(); await alertIncludes("応答画像が見つかりません");
    expect(files.size).toBe(0); expect(navigator.clipboard.writeText).not.toHaveBeenCalled(); expect(view.tab().draft).toBe(original); closeImage(); await loadHistory("healthy"); await openImage(); await copyImage(); expect(files.size).toBe(1);
  });
  it("B03-N18 古い会話の送信確認を取り消しても下書きと画像を保持し許可後だけ送る", async () => {
    const value = draft(); value.lastMessageAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); store.sessions = [value]; vi.mocked(window.confirm).mockReturnValueOnce(false).mockReturnValueOnce(true);
    host(); await ready(); addFile(); await screen.findByLabelText("画像1の名前"); await submitQuestion("保持する再質問");
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })).toBeEnabled());
    expect(generateCodex).not.toHaveBeenCalled(); expect(screen.getByLabelText("指示")).toHaveValue("保持する再質問"); expect(screen.getByLabelText("画像1の名前")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })); await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1)); expect(vi.mocked(generateCodex).mock.calls[0][0].images).toEqual([{ base64: imageA }]);
  });
  it("B03-N20 履歴上限で拒否された後に新会話を開始すると旧履歴を送信せず回復する", async () => {
    const value = draft(); value.messages = Array.from({ length: 42 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `過去${index}`, timestamp: new Date().toISOString(), attachmentIds: [] })); store.sessions = [value];
    host(); await submitQuestion("短い質問"); await alertIncludes("送信量が上限"); expect(generateCodex).not.toHaveBeenCalled(); expect(screen.getByLabelText("指示")).toHaveValue("短い質問");
    fireEvent.click(screen.getByRole("button", { name: "新しい会話を開始" })); await submitQuestion("短い質問"); await waitFor(() => expect(generateCodex).toHaveBeenCalledTimes(1)); expect(vi.mocked(generateCodex).mock.calls[0][0].history).toEqual([]);
    await loadHistory("b03-owner"); expect(screen.getByText("過去41")).toBeInTheDocument();
  });
});
