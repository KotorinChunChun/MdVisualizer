import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";
import { readImageForEdit } from "../lib/commands";

vi.mock("../lib/commands", () => ({ saveRenderedImage: vi.fn(), createRenderedImage: vi.fn(), readImageForEdit: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (value: string) => `asset://${value}` }));
const nativeDrop = vi.hoisted(() => ({ callback: null as ((event: { payload: { type: string; paths: string[] } }) => void) | null }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: (callback: typeof nativeDrop.callback) => { nativeDrop.callback = callback; return Promise.resolve(vi.fn()); } }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); nativeDrop.callback = null; });

function setup(loaded = true, enableNativeDragDrop = false) {
  const active = new Map<string, Blob | MediaSource>();
  let sequence = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { const key = `blob:b04-${++sequence}`; active.set(key, blob); return key; });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(value => { active.delete(value); });
  const context = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (obj, key) => key in obj ? obj[key as keyof typeof obj] : () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,YmFrZWQ=");
  const onError = vi.fn();
  const view = render(<ImageAnnotationEditor target={{ rawSrc: "asset://b04-original.png", fullPath: "C:/b04-only/original.png", filename: "original.png", storage: "external" }} imageVersion={0} onApply={vi.fn()} onCancel={vi.fn()} onError={onError} enableNativeDragDrop={enableNativeDragDrop} />);
  const image = view.container.querySelector("img")!;
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 256 }, naturalHeight: { configurable: true, value: 128 }, complete: { configurable: true, value: true } });
  if (loaded) fireEvent.load(image);
  const replace = (name: string) => {
    fireEvent.change(view.container.querySelector(".annotation-editor__replacement-file")!, { target: { files: [new File([name], name, { type: "image/png" })] } });
    const source = image.getAttribute("src")!;
    if (loaded) fireEvent.load(image);
    return source;
  };
  const undo = () => fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
  const redo = () => fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
  return { ...view, image, active, revoke, replace, undo, redo, onError };
}

describe("B04-M04 ラスタ1差し替え素材の履歴と寿命", () => {
  it("素材A→B→Undo→Redoで両素材を保持し、閉じたとき一度ずつ解放する", () => {
    const t = setup(); const a = t.replace("A.png"); const b = t.replace("B.png");
    t.undo(); expect(t.image.getAttribute("src")).toBe(a); expect(t.active.has(a)).toBe(true); expect(t.active.has(b)).toBe(true);
    expect(screen.getByText("差し替え候補: A.png")).toBeTruthy();
    t.redo(); expect(t.image.getAttribute("src")).toBe(b); expect(t.active.has(b)).toBe(true);
    t.unmount(); expect(t.active.size).toBe(0); expect(t.revoke.mock.calls.map(call => call[0]).sort()).toEqual([a, b].sort());
  });
  it("Undo後に素材Cを選んだ場合、破棄されたRedoだけの素材Bを解放する", () => {
    const t = setup(); const a = t.replace("A.png"); const b = t.replace("B.png"); t.undo(); const c = t.replace("C.png");
    expect(t.active.has(a)).toBe(true); expect(t.active.has(b)).toBe(false); expect(t.active.has(c)).toBe(true);
    expect((screen.getByRole("button", { name: "やり直す" }) as HTMLButtonElement).disabled).toBe(true);
    t.undo(); expect(t.image.getAttribute("src")).toBe(a); expect(t.active.has(a)).toBe(true);
    t.unmount(); expect(t.active.size).toBe(0); expect(t.revoke).toHaveBeenCalledTimes(3);
  });
  it.each(["右へ90°回転", "編集をリセット"])("%sもUndoで素材へ戻れ、履歴から不要になった後だけ解放する", action => {
    const t = setup(); const a = t.replace("A.png");
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(t.image.getAttribute("src")).not.toBe(a); expect(t.active.has(a)).toBe(true);
    t.undo(); expect(t.image.getAttribute("src")).toBe(a); expect(t.active.has(a)).toBe(true);
    t.undo(); const c = t.replace("C.png"); expect(t.active.has(a)).toBe(false); expect(t.active.has(c)).toBe(true);
  });
  it("読込み失敗した新素材だけを解放してUndo内の直前素材を保持する", () => {
    const t = setup(); const a = t.replace("A.png"); const failed = t.replace("bad.png"); fireEvent.error(t.image);
    expect(t.active.has(failed)).toBe(false); expect(t.active.has(a)).toBe(true); expect(t.onError).toHaveBeenCalledOnce();
    t.undo(); expect(t.image.getAttribute("src")).toBe(a); expect(t.active.has(a)).toBe(true);
  });
  it("File選択後に画像を貼り付けても、直前の素材へUndoできる", () => {
    const t = setup(); const a = t.replace("A.png");
    fireEvent.paste(window, { clipboardData: { files: [new File(["B"], "B.png", { type: "image/png" })], getData: () => "" } });
    const b = t.image.getAttribute("src")!; fireEvent.load(t.image);
    t.undo(); expect(t.image.getAttribute("src")).toBe(a); expect(t.active.has(a)).toBe(true);
    t.redo(); expect(t.image.getAttribute("src")).toBe(b); expect(t.active.has(b)).toBe(true);
  });
  it("File選択後のnative dropでも、直前の素材へUndoできる", async () => {
    const t = setup(true, true); const a = t.replace("A.png");
    vi.mocked(readImageForEdit).mockResolvedValue("data:image/png;base64,bmF0aXZl");
    await act(async () => { nativeDrop.callback?.({ payload: { type: "drop", paths: ["C:/b04-only/B.png"] } }); });
    expect(t.image.getAttribute("src")).toBe("data:image/png;base64,bmF0aXZl");
    t.undo(); expect(t.image.getAttribute("src")).toBe(a); expect(t.active.has(a)).toBe(true);
    t.redo(); expect(t.image.getAttribute("src")).toBe("data:image/png;base64,bmF0aXZl");
  });
  it("元画像の読込み前に拒否した素材は履歴に残さず直ちに解放する", () => {
    const t = setup(false); t.replace("early.png"); expect(t.active.size).toBe(0); expect(t.revoke).toHaveBeenCalledOnce(); expect(t.onError).toHaveBeenCalledOnce();
  });
});
