import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { generateCodex } from "./api";
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
function mount(options: { current?: EditorSnapshot; selected?: CodexTarget | null; applyResult?: boolean; documentPath?: string; resolveDocumentPath?: () => Promise<string | null> } = {}) {
  let current = options.current ?? initial;
  const apply = vi.fn().mockReturnValue(options.applyResult ?? true);
  const view = render(<CodexPanel open onClose={vi.fn()} documentName="response.md" documentPath={options.documentPath ?? path} baseDir="C:/docs" documentText={current.content} available consultationTarget={options.selected} getSnapshot={() => current} applyProposal={apply} resolveDocumentPath={options.resolveDocumentPath} />);
  return { ...view, apply, changeSnapshot: (next: EditorSnapshot) => { current = next; } };
}
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
  await waitFor(() => expect(screen.getByLabelText("ツール")).toBeEnabled());
  if (kind === "new") fireEvent.click(screen.getByRole("button", { name: "新規画像を生成" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "画像編集を依頼" })).toBeEnabled());
  // 添付読込後のeffectと、送信から応答までの非同期更新を完了させる。
  // 有効表示だけを待たず、対象準備に続く更新も試験の操作前に反映する。
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" })); });
  return screen.findByRole("dialog", { name: "生成画像の差分" });
}
async function embeddedCandidate() {
  const content = '前\n\n![既存](data:image/png;base64,b3JpZ2luYWw= "説明")\n\n後';
  const selected = { ...resolveOperationTarget(content, { offset: content.indexOf('![') })!, documentId: 'doc:1', skillId: 'edit-image', conversationAction: 'new' as const };
  const view = mount({ current: { documentId: 'doc:1', content, from: 0, to: 0 }, selected });
  return { view, content, review: await generateImage('edit') };
}
beforeEach(() => {
  vi.clearAllMocks(); store.sessions = [];
  vi.mocked(generateCodex).mockResolvedValue({ answer: "候補", replacement: null });
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "codex_list_models") return [{ model: "gpt-5.6-luna", displayName: "試験用モデル", isDefault: true }];
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

describe("AI応答の挿入・生成候補の統合", () => {
  it.each([
    ["前に挿入", "前文\n候補\n対象行\n末尾"],
    ["置換", "前文\n候補\n末尾"],
    ["後に挿入", "前文\n対象行\n候補\n末尾"],
    ["カーソル位置に挿入", "前\n候補\n文\n対象行\n末尾"],
  ])("質問応答の%sは差分決定まで本文を書き換えない", async (label, expected) => {
    const view = mount({ selected: { ...initial, editMode: "question", conversationAction: "new" } });
    await sendQuestion();
    if (label === "カーソル位置に挿入") view.changeSnapshot({ ...initial, from: 1, to: 1 });
    const dialog = await chooseInsertion(label);
    expect(view.apply).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("変更後を直接編集")).toHaveValue(expected);
    expect(within(dialog).getByLabelText("変更前後のプレビュー")).toBeInTheDocument();
    expect(within(dialog).queryByText(/^全文置換:/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "決定" }));
    await waitFor(() => expect(view.apply).toHaveBeenCalledWith(expect.objectContaining({ content: initial.content, from: 0, to: initial.content.length }), expected));
  });
  it("対象なしの置換は全文を対象にする", async () => {
    const view=mount(); await sendQuestion(); const dialog=await chooseInsertion("置換");
    expect(within(dialog).getByLabelText("変更後を直接編集")).toHaveValue("候補");
    expect(within(dialog).getByText(/^全文置換:/)).toBeInTheDocument();
    expect(view.apply).not.toHaveBeenCalled();
  });
  it("質問のコピーはMarkdownを直接コピーして文書を変更しない", async () => {
    vi.mocked(generateCodex).mockResolvedValue({ answer: "**回答**", replacement: null });
    const view=mount(); await sendQuestion();
    fireEvent.click(screen.getByRole("button", {name:"挿入"}));
    fireEvent.click(within(screen.getByRole("group",{name:"応答の挿入方法"})).getByRole("button",{name:"コピー"}));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("**回答**"));
    expect(view.apply).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("差分確認中に本文が変わると決定しても反映しない", async () => {
    const view=mount({selected:{...initial,editMode:"question",conversationAction:"new"}}); await sendQuestion();
    const dialog=await chooseInsertion("置換"); view.changeSnapshot({...initial,content:"利用者の追記"});
    fireEvent.click(within(dialog).getByRole("button",{name:"決定"}));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("本文や文書が変わりました"));
    expect(view.apply).not.toHaveBeenCalled();
  });
  it.each(["new","edit"] as const)("%s画像候補は画像差分からコード差分へ進み決定後だけ配置・反映する", async kind => {
    const content="前\n\n![既存](old.png)\n\n後";
    const target={...resolveOperationTarget(content,{offset:content.indexOf('![')})!,documentId:'doc:1',skillId:'edit-image',conversationAction:'new' as const};
    const view=mount({current:{documentId:'doc:1',content,from:0,to:0},selected:kind==='edit'?target:null});
    const review=await generateImage(kind);
    expect(within(review).getByRole('img',{name:'変更後の画像'})).toHaveAttribute('src','data:image/png;base64,bmV3');
    expect(invoke).not.toHaveBeenCalledWith('codex_commit_candidate',expect.anything());
    expect(view.apply).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole('button',{name:kind==='edit'?'置換':'後に挿入'}));
    const dialog=await screen.findByRole('dialog',{name:'AI変更案のプレビュー'});
    const expected=kind==='edit'?'前\n\n![既存](images/new.png)\n\n後':content+'\n![](images/new.png)';
    expect(within(dialog).getByLabelText('変更後を直接編集')).toHaveValue(expected);
    expect(invoke).toHaveBeenCalledWith('codex_candidate_preview',{id:'candidate',markdown:expected});
    const previews = within(dialog).getAllByTestId('rendered-preview');
    expect(previews[0]).toHaveAttribute('data-base-dir', 'C:/docs');
    expect(previews[1]).toHaveAttribute('data-base-dir', 'C:/docs');
    expect(previews[0]).toHaveAttribute('data-staged-previews', '{}');
    expect(JSON.parse(previews[1].getAttribute('data-staged-previews')!)).toEqual({ 'images/new.png': 'asset://fixture/C%3A%2Fcache%2Fcandidate%2Fimages%2Fnew.png' });
    expect(previews[1].textContent).toContain('![');
    expect(previews[1].textContent).toContain('(images/new.png)');
    expect(previews[1].textContent).not.toContain('data:image');
    expect(invoke).not.toHaveBeenCalledWith('codex_commit_candidate',expect.anything());
    fireEvent.click(within(dialog).getByRole('button',{name:'決定'}));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:true}));
    expect(view.apply).toHaveBeenCalledWith(expect.anything(),expected);
  });
  it("生成画像を含むコピー失敗は配置をロールバックし本文を保持する", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('clipboard denied'));
    const view=mount(); const review=await generateImage('new');
    fireEvent.click(within(review).getByRole('button',{name:'コピー'}));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:false}));
    expect(invoke).toHaveBeenCalledWith('codex_commit_candidate',{id:'candidate'});
    expect(view.apply).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').some(item=>item.textContent?.includes('clipboard denied'))).toBe(true);
  });
  it("画像付きコピーは配置完了後に相対参照をコピーし本文を変更しない", async () => {
    const view=mount(); const review=await generateImage('new');
    fireEvent.click(within(review).getByRole('button',{name:'コピー'}));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:true}));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('![](images/new.png)');
    const commit=vi.mocked(invoke).mock.calls.findIndex(([command])=>command==='codex_commit_candidate');
    expect(vi.mocked(invoke).mock.invocationCallOrder[commit]).toBeLessThan(vi.mocked(navigator.clipboard.writeText).mock.invocationCallOrder[0]);
    expect(view.apply).not.toHaveBeenCalled();
  });
  it("埋め込み画像の編集候補もコピー時は実ファイル配置後に相対参照をコピーする", async () => {
    const { view, review } = await embeddedCandidate();
    fireEvent.click(within(review).getByRole('button', { name: 'コピー' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_finish_candidate', { id: 'candidate', accepted: true }));
    expect(invoke).toHaveBeenCalledWith('codex_prepare_candidate', { request: { documentPath: path, base64: 'bmV3', filename: 'new.png' } });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('![既存](images/new.png "説明")');
    const commit = vi.mocked(invoke).mock.calls.findIndex(([command]) => command === 'codex_commit_candidate');
    expect(vi.mocked(invoke).mock.invocationCallOrder[commit]).toBeLessThan(vi.mocked(navigator.clipboard.writeText).mock.invocationCallOrder[0]);
    expect(view.apply).not.toHaveBeenCalled();
  });
  it.each(['codex_prepare_candidate', 'codex_commit_candidate'])("埋め込み画像候補のコピーで%sに失敗するとクリップボードと本文を保持する", async failingCommand => {
    const { view, review } = await embeddedCandidate();
    const normal = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === failingCommand) throw new Error('画像を配置できません');
      return normal(command, args);
    });
    fireEvent.click(within(review).getByRole('button', { name: 'コピー' }));
    await waitFor(() => expect(within(review).getByRole('alert')).toHaveTextContent('画像を配置できません'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(view.apply).not.toHaveBeenCalled();
    if (failingCommand === 'codex_commit_candidate') expect(invoke).toHaveBeenCalledWith('codex_finish_candidate', { id: 'candidate', accepted: false });
    expect(within(review).getByRole('button', { name: 'コピー' })).toBeEnabled();
  });
  it("埋め込み画像候補を採用するときはファイル化せずData URIを維持する", async () => {
    const { view, content, review } = await embeddedCandidate();
    fireEvent.click(within(review).getByRole('button', { name: '置換' }));
    const dialog = await screen.findByRole('dialog', { name: 'AI変更案のプレビュー' });
    const expected = content.replace('b3JpZ2luYWw=', 'bmV3');
    expect(within(dialog).getByLabelText('変更後を直接編集')).toHaveValue(expected);
    expect(view.apply).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await waitFor(() => expect(view.apply).toHaveBeenCalledWith(expect.anything(), expected));
    expect(invoke).not.toHaveBeenCalledWith('codex_prepare_candidate', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('codex_commit_candidate', expect.anything());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
  it("埋め込み候補の変更後コピーも画像を配置し、手編集を保った相対Markdown全文をコピーする", async () => {
    const { view, content, review } = await embeddedCandidate();
    fireEvent.click(within(review).getByRole('button', { name: '置換' }));
    const dialog = await screen.findByRole('dialog', { name: 'AI変更案のプレビュー' });
    const edited = content.replace('b3JpZ2luYWw=', 'bmV3') + '\n手編集の追記';
    fireEvent.change(within(dialog).getByLabelText('変更後を直接編集'), { target: { value: edited } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'コード差分を表示' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '変更後をコピー' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(edited.replace('data:image/png;base64,bmV3', 'images/new.png')));
    expect(invoke).toHaveBeenCalledWith('codex_finish_candidate', { id: 'candidate', accepted: true });
    expect(view.apply).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '決定' }));
    await waitFor(() => expect(view.apply).toHaveBeenCalledWith(expect.anything(), edited));
    expect(invoke).not.toHaveBeenCalledWith('codex_finish_candidate', { id: 'candidate', accepted: false });
  });
  it("本文反映が拒否されると配置を戻して候補を残す", async () => {
    const view=mount({applyResult:false}); const review=await generateImage('new');
    fireEvent.click(within(review).getByRole('button',{name:'後に挿入'}));
    const dialog=await screen.findByRole('dialog',{name:'AI変更案のプレビュー'});
    fireEvent.click(within(dialog).getByRole('button',{name:'決定'}));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:false}));
    expect(view.apply).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog',{name:'生成画像の差分'})).toBeInTheDocument();
  });
  it("画像の配置に失敗したときは参照コードだけをコピーしない", async () => {
    const view=mount(); const review=await generateImage('new');
    vi.mocked(invoke).mockImplementation(async command=> { if(command==='codex_prepare_candidate') throw new Error('保存先に書き込めません'); return undefined; });
    fireEvent.click(within(review).getByRole('button',{name:'コピー'}));
    await waitFor(() => expect(screen.getAllByRole('alert').some(item=>item.textContent?.includes('保存先に書き込めません'))).toBe(true));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled(); expect(view.apply).not.toHaveBeenCalled();
  });
  it("プレビュー作成が拒否された場合は未配置の候補を解放し再操作できる", async () => {
    const view=mount(); const review=await generateImage('new');
    const normal=vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command,args)=> {
      if(command==='codex_candidate_preview') throw new Error('プレビューが大きすぎます。');
      return normal(command,args);
    });
    fireEvent.click(within(review).getByRole('button',{name:'後に挿入'}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:false}));
    expect(invoke).not.toHaveBeenCalledWith('codex_commit_candidate',expect.anything());
    expect(view.apply).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog',{name:'生成画像の差分'})).toBeInTheDocument();
    expect(within(review).getByRole('button',{name:'後に挿入'})).toBeEnabled();
    expect(within(review).getByRole('alert')).toHaveTextContent('プレビューが大きすぎます。');
  });
  it.each(['insert','copy'])("%s成功後の履歴確定エラーで参照先画像を削除しない", async action => {
    const view=mount(); const review=await generateImage('new');
    const normal=vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args)=> {
      if(command==='codex_finish_candidate' && (args as {accepted:boolean}).accepted) throw new Error('finalize failed');
      return normal(command,args);
    });
    fireEvent.click(within(review).getByRole('button',{name:action==='copy'?'コピー':'後に挿入'}));
    if(action==='insert') {
      const dialog=await screen.findByRole('dialog',{name:'AI変更案のプレビュー'});
      fireEvent.click(within(dialog).getByRole('button',{name:'決定'}));
      await waitFor(()=>expect(view.apply).toHaveBeenCalledOnce());
    } else await waitFor(()=>expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    await waitFor(()=>expect(screen.getAllByRole('alert').some(item=>item.textContent?.includes('finalize failed'))).toBe(true));
    expect(invoke).not.toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:false});
  });
  it("配置の完了待ちに本文が変われば反映前に止めてロールバックする", async () => {
    const view=mount(); const review=await generateImage('new');
    fireEvent.click(within(review).getByRole('button',{name:'後に挿入'}));
    const dialog=await screen.findByRole('dialog',{name:'AI変更案のプレビュー'});
    let finish!:()=>void;
    const pending=new Promise<void>(resolve=>{finish=resolve;});
    const normal=vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command,args)=>command==='codex_commit_candidate'?pending:normal(command,args));
    fireEvent.click(within(dialog).getByRole('button',{name:'決定'}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('codex_commit_candidate',{id:'candidate'}));
    view.changeSnapshot({...initial,content:'編集中の本文'}); finish();
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:false}));
    expect(view.apply).not.toHaveBeenCalled();
  });
  it("候補準備中にパネルを閉じた場合は遅い結果を配置・コピーしない", async () => {
    const view=mount(); const review=await generateImage('new');
    let finish!:(value:unknown)=>void;
    const pending=new Promise(resolve=>{finish=resolve;});
    const normal=vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command,args)=>command==='codex_prepare_candidate'?pending:normal(command,args));
    fireEvent.click(within(review).getByRole('button',{name:'コピー'}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('codex_prepare_candidate',expect.anything()));
    view.unmount(); finish({id:'candidate',source:'images/new.png',previewDir:'C:/cache/candidate'});
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('codex_finish_candidate',{id:'candidate',accepted:false}));
    expect(invoke).not.toHaveBeenCalledWith('codex_commit_candidate',expect.anything());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
  it("画像生成待ちに新しい会話を開始しても旧応答が混入しない", async () => {
    let finish!:(value:unknown)=>void;
    const pending=new Promise(resolve=>{finish=resolve;});
    const normal=vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command,args)=>command==='codex_edit_image'?pending:normal(command,args));
    mount();
    await waitFor(()=>expect(screen.getByLabelText('ツール')).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'新規画像を生成'}));
    fireEvent.click(screen.getByRole('button',{name:'画像編集を依頼'}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('codex_edit_image',expect.anything()));
    fireEvent.click(screen.getByRole('button',{name:'新しい会話を開始'}));
    await act(async()=>finish({base64:'bmV3',mediaType:'image/png',filename:'new.png'}));
    expect(screen.queryByRole('dialog',{name:'生成画像の差分'})).toBeNull();
    expect(screen.queryByRole('button',{name:'画像差分を確認'})).toBeNull();
  });
  it("保存先不明の候補は保存先選択後の世代へ接続しコード差分を提示する", async () => {
    let current=initial, documentPath='';
    const apply=vi.fn().mockReturnValue(true);
    const resolve=vi.fn(async()=>{
      current={...initial,documentId:'doc:2'}; documentPath=path;
      view.rerender(panel());
      await new Promise(resolve=>setTimeout(resolve,0));
      return path;
    });
    const panel=()=> <CodexPanel open onClose={vi.fn()} documentName="response.md" documentPath={documentPath} documentText={current.content} available getSnapshot={()=>current} applyProposal={apply} resolveDocumentPath={resolve} />;
    const view=render(panel());
    const review=await generateImage('new');
    fireEvent.click(within(review).getByRole('button',{name:'後に挿入'}));
    const dialog=await screen.findByRole('dialog',{name:'AI変更案のプレビュー'});
    expect(resolve).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('codex_prepare_candidate',{request:expect.objectContaining({documentPath:path})});
    fireEvent.click(within(dialog).getByRole('button',{name:'決定'}));
    await waitFor(()=>expect(apply).toHaveBeenCalledWith(expect.objectContaining({documentId:'doc:2'}),expect.any(String)));
    expect(screen.getByRole('button',{name:'画像差分を確認'})).toBeInTheDocument();
  });
  it("生成候補と応答画像は会話に保存され再マウント後も比較できる", async () => {
    const view=mount(); await generateImage('new');
    await waitFor(() => expect(store.sessions.some(session=>session.messages.some(message=>message.response?.image))).toBe(true));
    const saved=store.sessions.find(session=>session.messages.some(message=>message.response?.image))!;
    expect(saved.attachments.find(item=>item.label==='応答画像')?.base64).toBe('bmV3');
    view.unmount();
    mount({current:{...initial,documentId:'new-tab:8'}});
    fireEvent.click(await screen.findByRole('button',{name:'画像差分を確認'}));
    const dialog=await screen.findByRole('dialog',{name:'生成画像の差分'});
    expect(within(dialog).getByRole('img',{name:'変更後の画像'})).toHaveAttribute('src','data:image/png;base64,bmV3');
  });
  it("キャプション生成は同じ画像の選択した出現箇所だけを提案する", async () => {
    const content='前\n\n![元](same.png)\n\n![元](same.png)\n\n後';
    const selected={...resolveOperationTarget(content,{offset:content.lastIndexOf('![')})!,documentId:'doc:1',skillId:'generate-caption',editMode:'selection' as const,conversationAction:'new' as const};
    vi.mocked(generateCodex).mockResolvedValue({answer:'キャプション案',replacement:'生成した説明'});
    const view=mount({current:{documentId:'doc:1',content,from:0,to:0},selected});
    await waitFor(() => expect(screen.getByRole('button',{name:'送信（Ctrl+Enter）'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'送信（Ctrl+Enter）'}));
    const dialog=await screen.findByRole('dialog',{name:'AI変更案のプレビュー'});
    expect(within(dialog).getByLabelText('変更後を直接編集')).toHaveValue('前\n\n![元](same.png)\n\n![生成した説明](same.png)\n\n後');
    expect(view.apply).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('codex_edit_image',expect.anything());
  });
});
