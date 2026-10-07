// @ts-expect-error 製品へNode型を追加せず、試験専用のjsdomを読み込む。
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rasterEditor2Document } from "./rasterEditor2Host";

type FrameWindow = Window & typeof globalThis;
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: { runScripts: string; url: string; beforeParse: (window: FrameWindow) => void }) => { window: FrameWindow } };
const windows: FrameWindow[] = [];
const format = "screenpresso-modoki-project";
const image = { dataUrl: "data:image/png;base64,fixture", width: 200, height: 100 };

function setup() {
  const messages: Record<string, unknown>[] = [];
  let win: FrameWindow;
  const parent = { postMessage: (message: Record<string, unknown>) => {
    messages.push(message);
    if (message.type === "confirm-replace") queueMicrotask(() => win.dispatchEvent(new win.MessageEvent("message", { source: parent as unknown as Window, data: { channel: "mdv-image", session: "b04-project", type: "confirm-replace-result", request: message.request, confirmed: true } })));
  } };
  const dom = new JSDOM(rasterEditor2Document("b04-project"), {
    runScripts: "dangerously", url: "https://fixture.invalid/", beforeParse(window) {
      Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", { value: function (this: HTMLCanvasElement) {
        return new Proxy({ canvas: this, measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }) }, { get: (value, key) => key in value ? value[key as keyof typeof value] : () => {} });
      } });
      Object.defineProperty(window.HTMLCanvasElement.prototype, "toDataURL", { value: () => image.dataUrl });
      window.Image = class { naturalWidth = 200; naturalHeight = 100; onload?: () => void; onerror?: () => void; set src(value: string) { queueMicrotask(() => value.endsWith("bad") ? this.onerror?.() : this.onload?.()); } } as unknown as typeof Image;
      window.URL.createObjectURL = vi.fn(() => "blob:fixture"); window.URL.revokeObjectURL = vi.fn();
      Object.defineProperty(window, "parent", { value: parent });
    },
  });
  win = dom.window; windows.push(win);
  win.eval("setImage({ naturalWidth: 160, naturalHeight: 100 }); state.objects = [makeObject('rect', 1, 2, 30, 20)]; state.objects[0].value='最初の注釈'; measureTextObject(state.objects[0]); commit(); state.objects[0].value='追記した注釈'; measureTextObject(state.objects[0]); commit();");
  const original = win.eval("state.bg");
  const values = () => JSON.parse(win.eval("JSON.stringify({objects:state.objects, hist:state.hist.map(s=>({objects:s.objects,nextNumber:s.nextNumber})), hidx:state.hidx, nextNumber:state.nextNumber, seq:state.seq, sel:state.sel})"));
  const object = (type: string) => JSON.parse(win.eval(`(()=>{const seq=state.seq;const value=JSON.stringify(makeObject('${type}',10,20,30,40));state.seq=seq;return value;})()`)) as Record<string, unknown>;
  const load = async (data: unknown) => {
    Object.defineProperty(win, "projectFile", { configurable: true, value: new win.File([JSON.stringify(data)], "fixture.spmz") });
    await win.eval("loadProject(window.projectFile)");
  };
  return { win, original, values, object, load, messages };
}
afterEach(() => { for (const win of windows.splice(0)) win.close(); });

describe("B04-M01 SPMZ検証失敗時の原画像・注釈・履歴保持", () => {
  it.each(["objectsが配列でない", "注釈がnull", "線の点列が配列でない", "矢印の方向が不正", "文字属性がオブジェクト", "画像decode失敗"])("%s場合、編集とUndoを保持したまま有効なSPMZを再選択できる", async reason => {
    const t = setup(); const previous = t.values();
    const data: Record<string, unknown> = { format, version: 1, image, objects: [] };
    if (reason === "objectsが配列でない") data.objects = {};
    if (reason === "注釈がnull") data.objects = [null];
    if (reason === "線の点列が配列でない") data.objects = [{ ...t.object("pen"), pts: {} }];
    if (reason === "矢印の方向が不正") data.objects = [{ ...t.object("arrow"), dir: 9 }];
    if (reason === "文字属性がオブジェクト") data.objects = [{ ...t.object("number"), font: { toString: null } }];
    if (reason === "画像decode失敗") data.image = { ...image, dataUrl: "data:image/png;base64,bad" };
    await t.load(data);
    expect.soft(t.win.eval("state.bg")).toBe(t.original); expect.soft(t.values()).toEqual(previous);
    expect.soft(t.win.document.querySelector("#toast")?.textContent).toMatch(/開けません|復元できません/);
    t.win.eval("undo()"); expect(t.values().objects[0].value).toBe("最初の注釈");
    t.win.eval("redo()"); expect(t.values()).toEqual(previous);
    await t.load({ format, version: 1, image, objects: [], nextNumber: 7 });
    expect(t.win.eval("state.bg")).not.toBe(t.original); expect(t.values().objects).toEqual([]); expect(t.values().nextNumber).toBe(7);
    expect(t.values().hist).toHaveLength(1);
  });
  it("既存形式の全注釈と旧連番の既定値、未知の追加属性を復元し元のprojectを変更しない", async () => {
    const t = setup();
    const objects = ["arrow", "line", "rect", "ellipse", "pen", "highlight", "text", "callout", "mosaic", "blur", "number", "watermark"].map(type => t.object(type));
    delete objects[10].arrowEnabled; delete objects[10].arrowWidth; delete objects[10].arrowX; delete objects[10].arrowY;
    objects[2].futureProperty = { preserved: true }; objects[4].pts = [[0, 0], [0.5, 0.5]];
    const before = JSON.stringify(objects);
    await t.load({ format, version: 1, image, objects, nextNumber: 8 });
    const restored = t.values().objects;
    expect(restored).toHaveLength(12); expect(restored.map((o: { type: string }) => o.type)).toEqual(objects.map(o => o.type));
    expect(restored[10]).toMatchObject({ arrowEnabled: false, arrowWidth: 3 }); expect(restored[10].arrowX).toBeTypeOf("number");
    expect(restored[2].futureProperty).toEqual({ preserved: true }); expect(JSON.stringify(objects)).toBe(before); expect(t.values().nextNumber).toBe(8);
    expect(t.messages.filter(message => message.type === "confirm-replace")).toHaveLength(1);
  });
  it("objects省略の旧ファイルも、読み込める画像として扱う", async () => {
    const t = setup(); await t.load({ format, image }); expect(t.win.eval("state.bg")).not.toBe(t.original); expect(t.values().objects).toEqual([]);
  });
});
