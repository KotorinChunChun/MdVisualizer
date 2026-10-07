import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { generateCodex } from "./api";
import { CodexPanel } from "./CodexPanel";
import type { CodexTarget } from "./scope";
import type { EditorSnapshot } from "./model";
import type { CodexConversation } from "./sessions";
import { createRef } from "react";
import { MarkdownEditor, type MarkdownEditorHandle } from "../../components/MarkdownEditor";
import { responseProposal } from "./responseActions";

const store = vi.hoisted(() => ({ sessions: [] as CodexConversation[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://fixture/${encodeURIComponent(path)}` }));
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn().mockResolvedValue(undefined), listCodexLogs: vi.fn().mockResolvedValue({ entries: [], limit: 20 }), setCodexLogLimit: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn().mockResolvedValue({ codex: { enabled: true, model: "gpt-5.6-luna" } }), saveSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("./sessions", async original => ({
  ...await original<typeof import("./sessions")>(),
  loadCodexSessions: vi.fn(async () => ({ sessions: store.sessions, retentionDays: 30 })),
  upsertCodexSession: vi.fn(async (session: CodexConversation) => { store.sessions = [structuredClone(session), ...store.sessions.filter(item => item.id !== session.id)]; return { sessions: store.sessions, retentionDays: 30 }; }),
}));
vi.mock("./imageTranscription", async original => ({ ...await original<typeof import("./imageTranscription")>(), loadTranscriptionImage: vi.fn().mockResolvedValue({ base64: "b3JpZ2luYWw=", mime: "image/png" }) }));
vi.mock("./preview", () => ({ CodexMarkdownPreview: ({ source, baseDir, stagedAssetPreviews }: { source: string; baseDir?: string; stagedAssetPreviews?: Record<string, string> }) => <pre data-testid="rendered-preview" data-base-dir={baseDir} data-staged-previews={JSON.stringify(stagedAssetPreviews ?? {})}>{source}</pre>, diagramImage: vi.fn() }));
vi.mock("./skills", () => ({ useCodexSkills: () => [
  { id: "edit-image", prompt: "画像を修正してください。", config: { mode: "selection", inputs: ["image"] } },
  { id: "generate-caption", prompt: "キャプションだけ生成してください。", config: { mode: "selection", inputs: ["image"] } },
] }));

const path = "C:/docs/response.md";
const initial: EditorSnapshot = { documentId: "doc:1", content: "前文\n対象行\n末尾", from: 3, to: 6 };
async function sendQuestion() {
  await waitFor(() => expect(screen.getByLabelText("指示")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("編集の許可"), { target: { value: "question" } });
  fireEvent.change(screen.getByLabelText("指示"), { target: { value: "教えてください" } });
  fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" }));
  await screen.findByRole("button", { name: "挿入" });
}
async function chooseInsertion(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "挿入" }));
  fireEvent.click(within(screen.getByRole("group", { name: "応答の挿入方法" })).getByRole("button", { name: label }));
  return screen.findByRole("dialog", { name: "AI変更案のプレビュー" });
}
async function generateImage(kind: "new" | "edit") {
  // 設定・会話のmock読込と初期effectを完了させてから利用操作を始める。
  // readyのDOM更新だけを待つと、会話復元effectより先にfireEventが走り得る。
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(screen.getByLabelText("ツール")).toBeEnabled());
  if (kind === "new") fireEvent.click(screen.getByRole("button", { name: "新規画像を生成" }));
  if (kind === "new") expect(screen.getByLabelText('編集指示')).toHaveValue('指示に従ってPNG画像を生成してください。');
  await waitFor(() => expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
  return screen.findByRole("dialog", { name: "生成画像の差分" });
}
beforeEach(() => {
  vi.clearAllMocks(); store.sessions = [];
  vi.mocked(generateCodex).mockResolvedValue({ answer: "候補", replacement: null });
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "codex_edit_image") return { base64: "bmV3", mediaType: "image/png", filename: "new.png" };
    if (command === "codex_prepare_candidate") return { id: "candidate", source: "images/new.png", previewDir: "C:/cache/candidate" };
    return undefined;
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(async () => {
  cleanup();
  // unmountが予約した履歴保存を次のテストのstore初期化前に完了させる。
  await act(async () => { await Promise.resolve(); });
});

// 既存の応答統合試験と同じ外部境界だけをmockし、自然な連続操作を監査する。
function liveMount(options: { content?: string; selected?: CodexTarget; documentPath?: string; resolver?: () => Promise<string | null>; applyAsync?: (base: EditorSnapshot, value: string) => Promise<boolean> } = {}) {
  let current: EditorSnapshot = { documentId: 'doc:1', content: options.content ?? initial.content, from: 0, to: 0 };
  let activePath = options.documentPath ?? path;
  const apply = vi.fn((base: EditorSnapshot, value: string) => {
    if (current.content !== base.content || current.documentId !== base.documentId) return false;
    current = { ...current, content: value };
    view.rerender(panel());
    return true;
  });
  // App.tsxと同じくタブIDのkeyで文書切替時はunmountする。
  const panel = () => <CodexPanel key={current.documentId} open onClose={vi.fn()} documentName={activePath.split('/').pop() ?? 'untitled.md'} documentPath={activePath} baseDir="C:/docs" documentText={current.content} available consultationTarget={options.selected} getSnapshot={() => current} applyProposal={apply} applyProposalAsync={options.applyAsync} resolveDocumentPath={options.resolver} />;
  const view = render(panel());
  return { ...view, apply, current: () => current, setDocument(content: string, documentPath = activePath, id = current.documentId) { current = { ...current, content, documentId: id }; activePath = documentPath; view.rerender(panel()); } };
}

function candidateBoundary() {
  const plans = new Map<string, { source: string; committed: boolean }>();
  const files = new Set<string>(); let next = 0;
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === 'codex_prepare_candidate') {
      const id = `natural-${++next}`, source = `image/new-${next}.png`;
      plans.set(id, { source, committed: false });
      return { id, source, previewDir: `C:/cache/${id}` };
    }
    if (command === 'codex_commit_candidate') {
      const plan = plans.get(args.id); if (!plan) throw new Error('画像候補を準備し直してください。');
      plan.committed = true; files.add(plan.source); return;
    }
    if (command === 'codex_finish_candidate') {
      const plan = plans.get(args.id); if (!plan) throw new Error('画像候補を確認できません。');
      if (!args.accepted && plan.committed) files.delete(plan.source);
      plans.delete(args.id); return;
    }
    return original(command, args);
  });
  return { plans, files };
}
async function imageToCode(label = '後に挿入') {
  const review = screen.getByRole('dialog', { name: '生成画像の差分' });
  fireEvent.click(within(review).getByRole('button', { name: label }));
  return screen.findByRole('dialog', { name: 'AI変更案のプレビュー' });
}
async function confirmCode(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI変更案のプレビュー' })).toBeNull());
}
async function reopenImage() {
  fireEvent.click(screen.getByRole('button', { name: '画像差分を確認' }));
  return screen.findByRole('dialog', { name: '生成画像の差分' });
}

describe('B01 AI応答候補の自然な連続操作', () => {
  it('B01-R01 画像差分とコード差分を閉じて再確認し、最後の決定だけを採用する', async () => {
    const boundary = candidateBoundary(), view = liveMount();
    const first = await generateImage('new');
    fireEvent.click(within(first).getByRole('button', { name: '閉じる' }));
    expect(view.current().content).toBe(initial.content); expect(boundary.files.size).toBe(0);
    await reopenImage(); const preview = await imageToCode();
    fireEvent.click(within(preview).getByRole('button', { name: '変更案の確認を閉じる' }));
    await waitFor(() => expect(boundary.plans.size).toBe(0));
    expect(view.apply).not.toHaveBeenCalled(); expect(boundary.files.size).toBe(0);
    await reopenImage(); await confirmCode(await imageToCode());
    expect(view.current().content).toBe(initial.content + '\n![](image/new-2.png)');
    expect([...boundary.files]).toEqual(['image/new-2.png']);
  });
  it('B01-R02 画像をコピーしてから採用しても、コピー済みの参照先を失わず本文は決定時だけ更新する', async () => {
    const boundary = candidateBoundary(), view = liveMount(); const image = await generateImage('new');
    fireEvent.click(within(image).getByRole('button', { name: 'コピー' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('![](image/new-1.png)'));
    expect(boundary.files.has('image/new-1.png')).toBe(true); expect(view.apply).not.toHaveBeenCalled();
    await confirmCode(await imageToCode());
    expect(view.current().content).toBe(initial.content + '\n![](image/new-2.png)');
    expect([...boundary.files]).toEqual(['image/new-1.png', 'image/new-2.png']);
  });
  it('B01-R03 採用を文書Undoで戻してから同じ履歴候補を再採用できる', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new');
    await confirmCode(await imageToCode());
    act(() => view.setDocument(initial.content));
    await reopenImage(); await confirmCode(await imageToCode());
    expect(view.current().content).toBe(initial.content + '\n![](image/new-2.png)');
    expect(view.apply).toHaveBeenCalledTimes(2); expect(boundary.files.has('image/new-1.png')).toBe(true);
  });
  it('B01-R04 CRLF文書の選択末尾が次行先頭でも、実Editor経路で改行形式を保つ', () => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    const content = '一行目\r\n二行目\r\n三行目';
    const ref = createRef<MarkdownEditorHandle>(), onChange = vi.fn();
    const props = { ref, documentId: 'crlf:1', dirty: false, saving: false, onChange, onSave: () => {} };
    const view = render(<MarkdownEditor {...props} value={content} />);
    const snapshot = ref.current!.snapshot()!;
    const value = responseProposal(snapshot, { ...snapshot, from: 0, to: 4 }, '補足1\n補足2', 'after');
    act(() => { expect(ref.current!.applyProposal({ ...snapshot, from: 0, to: snapshot.content.length }, value)).toBe(true); });
    expect(onChange).toHaveBeenLastCalledWith('一行目\r\n補足1\r\n補足2\r\n二行目\r\n三行目');
    view.unmount();
  });
  it('B01-R05 空文書への質問応答の後挿入は不要な空行を追加せず、差分後に採用する', async () => {
    const view = liveMount({ content: '' }); await sendQuestion(); const dialog = await chooseInsertion('後に挿入');
    expect(view.current().content).toBe(''); await confirmCode(dialog); expect(view.current().content).toBe('候補');
  });
  it('B01-R06 画像配置の保存先選択を取り消してから再操作すると候補を保持して採用できる', async () => {
    const boundary = candidateBoundary(), resolver = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(path);
    const view = liveMount({ documentPath: '', resolver }); const image = await generateImage('new');
    fireEvent.click(within(image).getByRole('button', { name: '後に挿入' }));
    await waitFor(() => expect(within(image).getByRole('alert')).toHaveTextContent('保存先を選んでください'));
    expect(boundary.plans.size).toBe(0); expect(view.apply).not.toHaveBeenCalled();
    await confirmCode(await imageToCode()); expect(view.apply).toHaveBeenCalledOnce(); expect(boundary.files.size).toBe(1);
  });
  it('B01-R07 コード差分確認中に別文書へ切り替えても、旧候補を新文書に採用せず戻って再確認できる', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); await imageToCode();
    act(() => view.setDocument('文書B', 'C:/docs/b.md', 'doc:2'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI変更案のプレビュー' })).toBeNull());
    expect(view.apply).not.toHaveBeenCalled(); expect(boundary.files.size).toBe(0);
    console.log('AUDIT switch-away', JSON.stringify({ plans: [...boundary.plans.keys()], files: [...boundary.files], content: view.current().content }));
    expect.soft(boundary.plans.size).toBe(0);
    act(() => view.setDocument(initial.content, path, 'doc:1'));
    await screen.findByRole('button', { name: '画像差分を確認' }); await reopenImage(); await confirmCode(await imageToCode());
    expect(view.current().content).toContain('![](image/new-2.png)');
    console.log('AUDIT switch-back-adopt', JSON.stringify({ plans: [...boundary.plans.keys()], files: [...boundary.files], content: view.current().content }));
    expect(boundary.plans.size).toBe(0);
  });
  it('B01-R08 手編集で画像参照を完全に除くと配置と本文反映を止め、候補を開き直せる', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    fireEvent.change(within(dialog).getByLabelText('変更後を直接編集'), { target: { value: initial.content + '\n画像は不要です' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await screen.findByRole('dialog', { name: '生成画像の差分' });
    expect(view.apply).not.toHaveBeenCalled(); expect(boundary.files.size).toBe(0);
    await confirmCode(await imageToCode()); expect(view.apply).toHaveBeenCalledOnce();
  });
  it('B01-R09 画像記法を外してパスを文章として残した場合も、画像候補としての採用を止める', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    fireEvent.change(within(dialog).getByLabelText('変更後を直接編集'), { target: { value: initial.content + '\n画像image/new-1.pngは採用しない' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await waitFor(() => expect(view.apply.mock.calls.length > 0 || screen.queryAllByRole('alert').length > 0).toBe(true));
    console.log('AUDIT plain-path', JSON.stringify({ files: [...boundary.files], content: view.current().content, adopted: screen.queryAllByText(/画像候補:/).map(node => node.textContent) }));
    expect.soft(screen.queryAllByRole('alert').some(node => node.textContent?.includes('画像参照が変更案から削除'))).toBe(true);
    expect(view.apply).not.toHaveBeenCalled(); expect(boundary.files.size).toBe(0);
  });
  it('B01-R10 画像候補のコード差分にある変更後コピーも、参照先配置を済ませてからコピーする', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    fireEvent.click(within(dialog).getByRole('button', { name: 'コード差分を表示' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '変更後をコピー' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    console.log('AUDIT review-copy', JSON.stringify({ copied: vi.mocked(navigator.clipboard.writeText).mock.calls[0][0], files: [...boundary.files], commands: vi.mocked(invoke).mock.calls.map(call => call[0]) }));
    expect.soft(boundary.files.has('image/new-1.png')).toBe(true);
    expect(view.apply).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '変更案の確認を閉じる' }));
    await waitFor(() => expect(boundary.plans.size).toBe(0));
    console.log('AUDIT review-copy-close', JSON.stringify({ plans: [...boundary.plans.keys()], files: [...boundary.files] }));
    expect(boundary.files.has('image/new-1.png')).toBe(true);
  });
  it('B01-R11 変更後コピーの失敗は配置を戻し、候補を再確認してコピーできる', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new');
    let dialog = await imageToCode();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard denied'));
    await copyAfter(dialog);
    await waitFor(() => expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('clipboard denied'))).toBe(true));
    expect(view.apply).not.toHaveBeenCalled(); expect(boundary.files.size).toBe(0);
    const image = screen.queryByRole('dialog', { name: '生成画像の差分' });
    if (image) dialog = await imageToCode();
    await copyAfter(dialog);
    await waitFor(() => expect(boundary.files.size).toBe(1));
    expect(view.current().content).toBe(initial.content);
  });
  it('B01-R12 変更後をコピーしてから却下してもコピー済みの画像を保持する', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    await copyAfter(dialog);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    fireEvent.click(within(dialog).getByRole('button', { name: '却下' }));
    await waitFor(() => expect(boundary.plans.size).toBe(0));
    expect([...boundary.files]).toEqual(['image/new-1.png']); expect(view.apply).not.toHaveBeenCalled();
    await waitFor(() => expect(store.sessions.some(session => session.messages.some(message => message.response?.image?.adoption?.method === '画像配置・コードコピー'))).toBe(true));
  });
  it('B01-R13 採用commit待ちのunmountは完了後にrollbackし、本文へ反映しない', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    const normal = vi.mocked(invoke).getMockImplementation()!, gate = deferred<void>();
    vi.mocked(invoke).mockImplementation(async (command, args) => { if (command === 'codex_commit_candidate') await gate.promise; return normal(command, args); });
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_commit_candidate', expect.anything()));
    view.unmount(); expect(boundary.plans.size).toBe(1);
    await act(async () => gate.resolve());
    await waitFor(() => expect(boundary.plans.size).toBe(0));
    expect(boundary.files.size).toBe(0); expect(view.apply).not.toHaveBeenCalled();
  });
  it('B01-R14 変更後clipboard待ちのunmountでも成功したコピーの参照先を保持する', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    const gate = deferred<void>(); vi.mocked(navigator.clipboard.writeText).mockImplementation(() => gate.promise);
    await copyAfter(dialog); await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    view.unmount(); await act(async () => gate.resolve());
    await waitFor(() => expect(boundary.plans.size).toBe(0));
    expect([...boundary.files]).toEqual(['image/new-1.png']); expect(view.apply).not.toHaveBeenCalled();
    await waitFor(() => expect(store.sessions.some(session => session.messages.some(message => message.response?.image?.adoption?.method === '画像配置・コードコピー'))).toBe(true));
  });
  it('B01-R15 変更後コピーの後処理失敗後に閉じても、コピー済み画像を削除しない', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    const normal = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => { if (command === 'codex_finish_candidate' && (args as { accepted: boolean }).accepted) throw new Error('finalize failed'); return normal(command, args); });
    await copyAfter(dialog);
    await waitFor(() => expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('finalize failed'))).toBe(true));
    const visible = screen.queryByRole('button', { name: '変更案の確認を閉じる' }); if (visible) fireEvent.click(visible);
    view.unmount(); await act(async () => { await Promise.resolve(); });
    expect([...boundary.files]).toEqual(['image/new-1.png']);
    expect(invoke).not.toHaveBeenCalledWith('codex_finish_candidate', { id: 'natural-1', accepted: false });
  });
  it('B01-R16 コードフェンス内だけに候補の画像記法がある変更案は採用しない', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    fireEvent.change(within(dialog).getByLabelText('変更後を直接編集'), { target: { value: initial.content + '\n\n```md\n![](image/new-1.png)\n```' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('画像参照が変更案から削除'))).toBe(true));
    expect(view.apply).not.toHaveBeenCalled(); expect(boundary.files.size).toBe(0);
  });
  it('B01-R17 inline code内だけに候補の画像記法がある変更案は採用しない', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    fireEvent.change(within(dialog).getByLabelText('変更後を直接編集'), { target: { value: initial.content + '\n`![](image/new-1.png)`' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('画像参照が変更案から削除'))).toBe(true));
    expect(view.apply).not.toHaveBeenCalled(); expect(boundary.files.size).toBe(0);
  });
  it('B01-R18 有効な参照型Markdown画像へ手編集した場合は候補を採用できる', async () => {
    const boundary = candidateBoundary(), view = liveMount(); await generateImage('new'); const dialog = await imageToCode();
    const source = initial.content + '\n\n![説明][generated]\n\n[generated]: image/new-1.png';
    fireEvent.change(within(dialog).getByLabelText('変更後を直接編集'), { target: { value: source } });
    await confirmCode(dialog);
    expect(view.current().content).toBe(source); expect([...boundary.files]).toEqual(['image/new-1.png']);
  });
  it('B01-R19 変更後コピーを連打しても処理中のcommitとclipboardを重複実行しない', async () => {
    const boundary = candidateBoundary(); liveMount(); await generateImage('new'); const dialog = await imageToCode();
    const normal = vi.mocked(invoke).getMockImplementation()!, gate = deferred<void>();
    vi.mocked(invoke).mockImplementation(async (command, args) => { if (command === 'codex_commit_candidate') await gate.promise; return normal(command, args); });
    await copyAfter(dialog); await copyAfter(dialog);
    await act(async () => gate.resolve());
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    expect(vi.mocked(invoke).mock.calls.filter(call => call[0] === 'codex_commit_candidate')).toHaveLength(1);
    expect([...boundary.files]).toEqual(['image/new-1.png']);
  });
  it('B01-R20 本文への非同期適用待ちにunmountしても適用が成功した画像を保持する', async () => {
    const boundary = candidateBoundary(), gate = deferred<boolean>(), applyAsync = vi.fn(() => gate.promise);
    const view = liveMount({ applyAsync }); await generateImage('new'); const dialog = await imageToCode();
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await waitFor(() => expect(applyAsync).toHaveBeenCalledOnce());
    view.unmount(); expect(boundary.files.has('image/new-1.png')).toBe(true);
    await act(async () => gate.resolve(true));
    await waitFor(() => expect(boundary.plans.size).toBe(0));
    expect([...boundary.files]).toEqual(['image/new-1.png']);
    expect(invoke).not.toHaveBeenCalledWith('codex_finish_candidate', { id: 'natural-1', accepted: false });
    await waitFor(() => expect(store.sessions.some(session => session.messages.some(message => message.response?.image?.status === 'adopted'))).toBe(true));
  });
  it('B01-R14追補 画像コピー待ちに新会話へ移っても完了メタデータを元会話へ保存する', async () => {
    const boundary = candidateBoundary(), view = liveMount();
    const image = await generateImage('new'), gate = deferred<void>();
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => gate.promise);
    fireEvent.click(within(image).getByRole('button', { name: 'コピー' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    fireEvent.click(within(image).getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '新しい会話を開始' }));
    await waitFor(() => expect(store.sessions.some(session => session.messages.some(message => message.response?.image))).toBe(true));
    const ownerId = store.sessions.find(session => session.messages.some(message => message.response?.image))!.id;
    await act(async () => gate.resolve());
    await waitFor(() => expect(boundary.plans.size).toBe(0));
    expect([...boundary.files]).toEqual(['image/new-1.png']);
    expect(view.apply).not.toHaveBeenCalled();
    await waitFor(() => expect(store.sessions.find(session => session.id === ownerId)?.messages.find(message => message.response?.image)?.response?.image?.adoption)
      .toMatchObject({ documentPath: path, source: 'image/new-1.png', method: '画像配置・コードコピー' }));
    expect(screen.queryByRole('button', { name: '画像差分を確認' })).toBeNull();
    fireEvent.change(screen.getByLabelText('編集指示'), { target: { value: '新しい会話の下書き' } });
    await waitFor(() => expect(store.sessions.some(session => session.id !== ownerId && session.draft.instruction === '新しい会話の下書き' && session.messages.length === 0)).toBe(true));
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function copyAfter(dialog: HTMLElement) {
  const show = within(dialog).queryByRole('button', { name: 'コード差分を表示' });
  if (show) fireEvent.click(show);
  fireEvent.click(within(dialog).getByRole('button', { name: '変更後をコピー' }));
}
