import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {CodexLogViewer} from "./CodexLogViewer";
import type {CodexLogData} from "./model";

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const data:CodexLogData={limit:20,entries:[{id:"image-request",createdAt:"2026-09-29T00:00:00Z",model:"model",requestPrompt:"CONTROL\nUSER",responseText:"生成完了",responseRaw:'{"type":"item.completed"}',inputTokens:null,cachedInputTokens:null,outputTokens:null,userPrompt:"USER",controlPrompt:"CONTROL",requestSettings:{arguments:["exec","--json"]},requestImages:[{base64:"INPUT_BASE64",mime:"image/png",filename:"before.png"}],responseImages:[{base64:"OUTPUT_BASE64",mime:"image/png",filename:"after.png"}],stderr:"diagnostic"}]};

describe("CodexLogViewer",()=>{
 it("画像の往復と候補状態を表示し、Base64は展開するまで本文に描画しない",async()=>{
  render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn()} candidateStates={{"image-request":"adopted"}}/>);
  expect(screen.getByText("生成候補: 採用済み")).toBeTruthy();expect(screen.getByText(/CLI内部のサービス通信は取得していません/)).toBeTruthy();expect(screen.getByAltText("before.png").getAttribute("src")).toContain("INPUT_BASE64");expect(screen.getByAltText("after.png").getAttribute("src")).toContain("OUTPUT_BASE64");
  expect(screen.queryByText(/"base64"/)).toBeNull();fireEvent.click(screen.getByText("Base64を含む生データを表示"));await waitFor(()=>expect(screen.getByText(/"base64"/)).toBeTruthy());
 });
 it("応答画像を拡大しEscapeは画像だけ閉じる",()=>{
  const close=vi.fn();render(<CodexLogViewer data={data} onClose={close} onLimitChange={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"応答画像1を拡大"}));const preview=screen.getByRole("dialog",{name:"通信記録の画像"});fireEvent.keyDown(preview,{key:"Escape"});expect(screen.queryByRole("dialog",{name:"通信記録の画像"})).toBeNull();expect(close).not.toHaveBeenCalled();
 });
 it("生データのコピーに画像・設定・標準エラーを含める",async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});render(<CodexLogViewer data={data} onClose={vi.fn()} onLimitChange={vi.fn()}/>);fireEvent.click(screen.getByRole("button",{name:"生データをコピー"}));await waitFor(()=>expect(writeText).toHaveBeenCalled());expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(data.entries[0]);
 });
 it("失敗ログと従来の画像なしログを開ける",()=>{
  const entry={...data.entries[0],requestImages:undefined,responseImages:undefined,error:"タイムアウト"};render(<CodexLogViewer data={{limit:20,entries:[entry]}} onClose={vi.fn()} onLimitChange={vi.fn()}/>);expect(screen.getByRole("alert").textContent).toBe("タイムアウト");expect(screen.getByText("diagnostic")).toBeTruthy();expect(screen.queryByRole("img")).toBeNull();
 });
});
