// @ts-expect-error 製品へNode型を導入せず、試験で使うjsdomだけを読み込む。
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import html from "../assets/rasterEditor2.html?raw";
import { rasterEditor2Document } from "./rasterEditor2Host";

type FrameWindow = Window & typeof globalThis;
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: { runScripts: string; url: string; beforeParse: (window: FrameWindow) => void }) => { window: FrameWindow } };
const windows: FrameWindow[] = [];
const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const deferred = () => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); return { promise, resolve }; };

function setup(embedded = false) {
  const images: { onload?: () => void; onerror?: () => void; naturalWidth: number; naturalHeight: number; src: string }[] = [];
  const parent = { postMessage: vi.fn() };
  const confirm = vi.fn<(...args: unknown[]) => boolean | Promise<boolean>>(() => false);
  const dom = new JSDOM(embedded ? rasterEditor2Document("fixture-session") : html, {
    runScripts: "dangerously", url: "https://fixture.invalid/",
    beforeParse(win) {
      const context = new Proxy({ measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }) }, { get: (value, key) => key in value ? value[key as keyof typeof value] : () => {} });
      Object.defineProperty(win.HTMLCanvasElement.prototype, "getContext", { value: () => context });
      Object.defineProperty(win.HTMLCanvasElement.prototype, "toDataURL", { value: () => "data:image/png;base64,fixture" });
      win.Image = class { naturalWidth = 200; naturalHeight = 100; onload?: () => void; onerror?: () => void; _src = ""; get src() { return this._src; } set src(value: string) { this._src = value; images.push(this); } } as unknown as typeof Image;
      win.URL.createObjectURL = vi.fn(() => "blob:fixture"); win.URL.revokeObjectURL = vi.fn();
      Object.defineProperty(win, "confirm", { configurable: true, value: confirm });
      if (embedded) Object.defineProperty(win, "parent", { value: parent });
    },
  });
  const win = dom.window; windows.push(win);
  win.eval("setImage({naturalWidth: 160, naturalHeight: 100}); state.objects = [{ id: 'o1', type: 'rect', x: 1, y: 2, w: 30, h: 20, value: '元の注釈' }]; commit();");
  const original = win.eval("state.bg") as HTMLCanvasElement;
  const load = () => win.eval("loadFromBlob(new Blob(['fixture'], { type: 'image/png' }))") as Promise<void> | undefined;
  const project = () => {
    const data = JSON.stringify({ format: "screenpresso-modoki-project", version: 1, image: { dataUrl: "data:image/png;base64,project" }, objects: [], nextNumber: 9 });
    Object.defineProperty(win, "fixtureProject", { configurable: true, value: new win.File([data], "fixture.spmz") });
    return win.eval("loadProject(window.fixtureProject)") as Promise<void> | undefined;
  };
  const state = () => win.eval("({ bg: state.bg, objects: JSON.stringify(state.objects), nextNumber: state.nextNumber })") as { bg: HTMLCanvasElement; objects: string; nextNumber: number };
  const change = () => win.eval("state.objects[0].value = '確認中の追記'; commit();");
  const reply = (extra: object, source: unknown = parent) => win.dispatchEvent(new win.MessageEvent("message", { source: source as Window, data: { channel: "mdv-image", session: "fixture-session", ...extra } }));
  return { win, images, confirm, parent, original, load, project, state, change, reply };
}
afterEach(() => { for (const win of windows.splice(0)) win.close(); });

describe("ラスタ編集2内部HTMLの読込みと非同期確認", () => {
  it("画像のPromise取消ではdecodeも注釈破棄も始めない", async () => {
    const t = setup(); const pending = deferred(); t.confirm.mockReturnValue(pending.promise);
    const loading = t.load(); await tick(); expect(t.images).toHaveLength(0);
    pending.resolve(false); await loading; expect(t.state().bg).toBe(t.original); expect(t.state().objects).toContain("元の注釈");
  });
  it("確認中の追記後には古いtrueを反映しない", async () => {
    const t = setup(); const pending = deferred(); t.confirm.mockReturnValue(pending.promise);
    const loading = t.load(); t.change(); pending.resolve(true); await loading;
    expect(t.images).toHaveLength(0); expect(t.state().objects).toContain("確認中の追記");
  });
  it("重複読込みを抑止し、承認した1画像のdecode完了後だけ差し替える", async () => {
    const t = setup(); const pending = deferred(); t.confirm.mockReturnValue(pending.promise);
    const first = t.load(); const duplicate = t.load(); await tick(); expect(t.confirm).toHaveBeenCalledOnce(); expect(t.images).toHaveLength(0);
    pending.resolve(true); await tick(); expect(t.images).toHaveLength(1); expect(t.state().bg).toBe(t.original);
    t.images[0].onload?.(); await Promise.all([first, duplicate]); expect(t.state().bg).not.toBe(t.original); expect(t.state().objects).toBe("[]");
    expect(t.win.URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("承認後のdecode待ちで追記した注釈も旧画像で消さない", async () => {
    const t = setup(); t.confirm.mockReturnValue(true); const loading = t.load(); await tick();
    expect(t.images).toHaveLength(1); t.change(); t.images[0].onload?.(); await loading;
    expect(t.state().bg).toBe(t.original); expect(t.state().objects).toContain("確認中の追記");
    expect(t.win.URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("SPMZのPromise取消も画像復元前に止まり、再選択で読み込める", async () => {
    const t = setup(); t.confirm.mockReturnValue(Promise.resolve(false));
    await t.project(); await tick(); await tick(); expect(t.images).toHaveLength(0); expect(t.state().bg).toBe(t.original);
    t.confirm.mockReturnValue(Promise.resolve(true)); const loading = t.project();
    await vi.waitFor(() => expect(t.images).toHaveLength(1)); t.images[0].onload?.(); await loading;
    expect(t.state().nextNumber).toBe(9); expect(t.state().objects).toBe("[]");
  });
  it("確認APIがrejectしても元の内容を保持し、次の選択で再試行できる", async () => {
    const t = setup(); t.confirm.mockImplementationOnce(() => Promise.reject(new Error("確認失敗")));
    await t.load(); expect(t.images).toHaveLength(0); expect(t.state().bg).toBe(t.original);
    t.confirm.mockReturnValue(true); const loading = t.load(); await tick(); expect(t.images).toHaveLength(1);
    t.images[0].onload?.(); await loading; expect(t.state().objects).toBe("[]");
  });
  it("SPMZ確認中の編集とdecode失敗後の再操作でも旧注釈を保持する", async () => {
    const t = setup(); const pending = deferred(); t.confirm.mockReturnValue(pending.promise);
    const old = t.project(); await vi.waitFor(() => expect(t.confirm).toHaveBeenCalledOnce()); t.change(); pending.resolve(true); await old;
    expect(t.images).toHaveLength(0); expect(t.state().objects).toContain("確認中の追記");
    t.confirm.mockReturnValue(true); const failed = t.project(); await vi.waitFor(() => expect(t.images).toHaveLength(1)); t.images[0].onerror?.(); await failed;
    expect(t.state().bg).toBe(t.original); expect(t.state().objects).toContain("確認中の追記");
    const retried = t.project(); await vi.waitFor(() => expect(t.images).toHaveLength(2)); t.images[1].onload?.(); await retried; expect(t.state().nextNumber).toBe(9);
  });
  it("親への確認要求は注入されたiframe confirmを呼ばず、照合できる結果だけ受理する", async () => {
    const t = setup(true); const loading = t.load(); await tick();
    expect(t.confirm).not.toHaveBeenCalled();
    const requests = t.parent.postMessage.mock.calls.map(call => call[0]).filter(value => value.type === "confirm-replace");
    expect(requests).toHaveLength(1); const request = requests[0].request;
    t.reply({ type: "confirm-replace-result", request, confirmed: true }, t.win);
    t.reply({ type: "confirm-replace-result", request, session: "other", confirmed: true });
    t.reply({ type: "confirm-replace-result", request: "other", confirmed: true }); await tick(); expect(t.images).toHaveLength(0);
    t.reply({ type: "confirm-replace-result", request, confirmed: false }); await loading; expect(t.state().bg).toBe(t.original);
  });
  it("親から別画像を読み直した後に古い確認のtrueが届いても置換しない", async () => {
    const t = setup(true); const loading = t.load(); await tick();
    const request = t.parent.postMessage.mock.calls.map(call => call[0]).find(value => value.type === "confirm-replace")?.request;
    expect(request).toBeTypeOf("string");
    t.reply({ type: "load", dataUri: "data:image/png;base64,newparent" }); expect(t.images).toHaveLength(1);
    t.images[0].onload?.(); const next = t.state().bg;
    t.reply({ type: "confirm-replace-result", request, confirmed: true }); await loading; await tick();
    expect(t.images).toHaveLength(1); expect(t.state().bg).toBe(next);
  });
});
