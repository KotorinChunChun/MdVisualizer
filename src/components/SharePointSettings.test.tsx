import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharePointSettings } from "./SharePointSettings";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
afterEach(cleanup);
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async command => {
    if (command === "last_sharepoint_uri") return null;
    if (command === "sharepoint_connection_info") return { clientId: "embedded-id", tenant: "organizations", directProtocolRegistration: false };
    throw new Error("URL形式が不正です");
  });
});
it("直接登録の未確認を接続失敗と断定せず、組み込み設定とMSIXの違いを表示する", async () => {
  render(<SharePointSettings onOpen={vi.fn()} />);
  expect(await screen.findByText("embedded-id")).toBeTruthy();
  expect(screen.getByText("確認できませんでした（MSIXの登録は別方式です）")).toBeTruthy();
  expect(screen.getByRole("button", { name: "URLを開く" }).hasAttribute("disabled")).toBe(true);
});
it("不正URLでは開かず、入力を保持して訂正後に同じ画面から再試行できる", async () => {
  const onOpen = vi.fn();
  render(<SharePointSettings onOpen={onOpen} />);
  await screen.findByText("embedded-id");
  const input = screen.getByLabelText("SharePointのURL") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "https://contoso.sharepoint.com/shared" } });
  fireEvent.click(screen.getByRole("button", { name: "URLを開く" }));
  await screen.findByRole("alert");
  expect(onOpen).not.toHaveBeenCalled();
  expect(input.value).toContain("/shared");
  invoke.mockResolvedValueOnce("spmd://contoso.sharepoint.com/sites/a/docs/readme.md");
  fireEvent.change(input, { target: { value: "https://contoso.sharepoint.com/sites/a/docs/readme.md" } });
  fireEvent.click(screen.getByRole("button", { name: "URLを開く" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith("spmd://contoso.sharepoint.com/sites/a/docs/readme.md"));
});
it("状態取得失敗を再確認できる", async () => {
  invoke.mockRejectedValueOnce(new Error("offline"));
  render(<SharePointSettings onOpen={vi.fn()} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "状態を再確認" }));
  expect(await screen.findByText("embedded-id")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("設定を閉じた後に届くURL検証応答で文書を開かない", async () => {
  const onOpen = vi.fn();
  const { unmount } = render(<SharePointSettings onOpen={onOpen} />);
  await screen.findByText("embedded-id");
  let finish!: (value: string) => void;
  invoke.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText("SharePointのURL"), { target: { value: "https://contoso.sharepoint.com/sites/a/docs/readme.md" } });
  fireEvent.click(screen.getByRole("button", { name: "URLを開く" }));
  unmount();
  finish("spmd://contoso.sharepoint.com/sites/a/docs/readme.md");
  await Promise.resolve();
  expect(onOpen).not.toHaveBeenCalled();
});


it("HTTPSのWikiからフォルダーをたどりMarkdownを選ぶ。HTMLは文書として開かない", async () => {
  const open = vi.fn();
  invoke.mockImplementation(async (command, args) => {
    if (command === "sharepoint_connection_info") return { clientId:"embedded-id",tenant:"organizations",directProtocolRegistration:false };
    if (command === "last_sharepoint_uri") return null;
    if (command === "validate_sharepoint_uri") return "spmd://contoso.sharepoint.com/Wiki";
    if (command === "list_sharepoint_folder") return args.value.endsWith("/sub")
      ? { uri:args.value,parentUri:"spmd://contoso.sharepoint.com/Wiki",entries:[{ name:"guide.md",uri:args.value+"/guide.md",folder:false }] }
      : { uri:args.value,parentUri:null,entries:[{ name:"sub",uri:args.value+"/sub",folder:true }] };
    throw new Error("Unexpected command");
  });
  render(<SharePointSettings onOpen={open} />);
  await screen.findByText("embedded-id");
  fireEvent.change(screen.getByLabelText("SharePointのURL"),{target:{value:"https://contoso.sharepoint.com/Wiki"}});
  fireEvent.click(screen.getByRole("button",{name:"URLを開く"}));
  fireEvent.click(await screen.findByRole("button",{name:"sub/"}));
  fireEvent.click(await screen.findByRole("button",{name:"guide.md"}));
  expect(open).toHaveBeenCalledWith("spmd://contoso.sharepoint.com/Wiki/sub/guide.md");
  expect(screen.getByRole("button",{name:"親フォルダー"})).toBeTruthy();
  expect(invoke.mock.calls.filter(([command])=>command==="validate_sharepoint_uri")).toHaveLength(1);
});

it("受信した原文・時刻・経路・具体的な拒否理由を表示し、明示操作だけでコピーする", async () => {
  const writeText=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  const received={value:"spmd://contoso.sharepoint.com/Wiki/a.md?token=fixture",receivedAt:"2026-10-29T00:00:00Z",origin:"起動引数",error:"クエリは使用できません。"};
  invoke.mockImplementation(async command=>command==="last_sharepoint_uri"?received:{clientId:"embedded-id",tenant:"organizations",directProtocolRegistration:false});
  render(<SharePointSettings onOpen={vi.fn()} />);
  await waitFor(()=>expect((screen.getByLabelText("直前の受信URL") as HTMLTextAreaElement).value).toBe(received.value));
  expect(screen.getByText("起動引数")).toBeTruthy();expect(screen.getByText(received.error)).toBeTruthy();
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"受信URLをコピー"}));
  expect(await screen.findByRole("status")).toBeTruthy();expect(writeText).toHaveBeenCalledWith(received.value);
  expect(invoke.mock.calls.every(([command])=>command!=="save_settings")).toBe(true);
});

it("起動フォルダーの自動取得は認証案内の準備を待つ", async () => {
  const received={value:"spmd://contoso.sharepoint.com/Wiki",receivedAt:"2026-10-29T00:00:00Z",origin:"再起動引数",error:null};
  invoke.mockImplementation(async command=>command==="last_sharepoint_uri"?received:command==="list_sharepoint_folder"?{uri:received.value,parentUri:null,entries:[]}:{clientId:"embedded-id",tenant:"organizations",directProtocolRegistration:false});
  const {rerender}=render(<SharePointSettings onOpen={vi.fn()} authenticationReady={false} />);
  await screen.findByText("embedded-id");expect(invoke.mock.calls.some(([command])=>command==="list_sharepoint_folder")).toBe(false);
  rerender(<SharePointSettings onOpen={vi.fn()} authenticationReady />);
  expect(await screen.findByText("Markdownファイルまたはフォルダーがありません。")).toBeTruthy();
  expect(invoke.mock.calls.filter(([command])=>command==="list_sharepoint_folder")).toHaveLength(1);
});

it("フォルダーの応答が設定を閉じた後に届いても操作しない", async () => {
  let finish!:(value:unknown)=>void;const settled=vi.fn();const open=vi.fn();
  invoke.mockImplementation(async command=>command==="last_sharepoint_uri"?null:command==="validate_sharepoint_uri"?"spmd://contoso.sharepoint.com/Wiki":command==="list_sharepoint_folder"?new Promise(resolve=>{finish=resolve;}):{clientId:"embedded-id",tenant:"organizations",directProtocolRegistration:false});
  const {unmount}=render(<SharePointSettings onOpen={open} onSettled={settled} />);
  await screen.findByText("embedded-id");fireEvent.change(screen.getByLabelText("SharePointのURL"),{target:{value:"https://contoso.sharepoint.com/Wiki"}});fireEvent.click(screen.getByRole("button",{name:"URLを開く"}));
  await waitFor(()=>expect(finish).toBeTypeOf("function"));unmount();finish({uri:"spmd://contoso.sharepoint.com/Wiki",parentUri:null,entries:[]});await Promise.resolve();await Promise.resolve();
  expect(open).not.toHaveBeenCalled();expect(settled).not.toHaveBeenCalled();
});

it("古い再確認応答で、新しく受信したURLや入力欄を巻き戻さない", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  let finish!: (value:unknown)=>void;
  invoke.mockImplementation(async command=>command==="last_sharepoint_uri"?new Promise(resolve=>{finish=resolve;}):{clientId:"embedded-id",tenant:"organizations",directProtocolRegistration:false});
  render(<SharePointSettings onOpen={vi.fn()} />);await screen.findByText("embedded-id");
  const handler=vi.mocked(listen).mock.calls[vi.mocked(listen).mock.calls.length - 1][1];
  const latest={value:"spmd://contoso.sharepoint.com/Wiki/latest.md",receivedAt:"2026-10-29T00:00:02Z",origin:"URL入力",error:null};
  await act(async()=>{handler({event:"sharepoint-uri-received",id:1,payload:latest});});
  await act(async()=>{finish({...latest,value:"spmd://contoso.sharepoint.com/Wiki/old.md",receivedAt:"2026-10-29T00:00:01Z"});});
  expect((screen.getByLabelText("直前の受信URL") as HTMLTextAreaElement).value).toBe(latest.value);
  expect((screen.getByLabelText("SharePointのURL") as HTMLInputElement).value).toBe(latest.value);
});
