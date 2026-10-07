import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";
import { RasterEditor2 } from "./RasterEditor2";
import { createRenderedImage, saveRenderedImage } from "../lib/commands";

vi.mock("../lib/commands", () => ({ createRenderedImage: vi.fn(), saveRenderedImage: vi.fn(), readImageForEdit: vi.fn() }));
vi.mock("../lib/rasterOutput", () => ({ saveRasterCopy: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(vi.fn()) }) }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const baseProps = () => ({ target: { rawSrc: png, filename: "original.png", fullPath: "C:/fixture/original.png", storage: "external" as const }, imageVersion: 0, onApply: vi.fn(), onCancel: vi.fn(), onReload: vi.fn().mockResolvedValue(undefined), onError: vi.fn(), enableNativeDragDrop: false });
const asyncConfirm = (operation: () => Promise<boolean>) => vi.spyOn(window, "confirm").mockImplementation(() => operation() as unknown as boolean);
function deferred() { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
  vi.stubGlobal("Image", class { naturalWidth = 160; naturalHeight = 100; onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()); } });
  const context = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (object, key) => key in object ? object[key as keyof typeof object] : vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });

async function setup(editor: number) {
  const Component = editor === 1 ? ImageAnnotationEditor : RasterEditor2;
  const props = baseProps(); const view = render(<Component {...props} />);
  let change: () => Promise<void>;
  if (editor === 1) {
    const image = view.container.querySelector("img")!;
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: 160 }, naturalHeight: { configurable: true, value: 100 } });
    fireEvent.load(image);
    change = async () => { const input = screen.getByLabelText("幅 (dot)") as HTMLInputElement; fireEvent.change(input, { target: { value: String(Number(input.value) + 20) } }); };
  } else {
    const frame = screen.getByTitle("ラスタ編集2画像編集") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage"); fireEvent.load(frame);
    await waitFor(() => expect(post.mock.calls.some(([message]) => message.type === "load")).toBe(true));
    const session = post.mock.calls.find(([message]) => message.type === "load")![0].session;
    const emit = async (message: Record<string, unknown>) => act(async () => { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { channel: "mdv-image", session, ...message } })); });
    await emit({ type: "loaded" }); change = () => emit({ type: "changed", dirty: true });
  }
  await change();
  return { ...view, Component, props, change };
}

describe.each([1, 2])("ラスタ編集%s: TauriのPromise確認への対応", editor => {
  it.each(["cancel", "reload"])("%sでPromise.resolve(false)なら編集を保持し破棄処理を呼ばない", async action => {
    const t = await setup(editor); const confirm = asyncConfirm(() => Promise.resolve(false));
    if (action === "reload") t.rerender(<t.Component {...t.props} imageVersion={1} />);
    const name = action === "reload" ? "最新画像を読み直す" : "キャンセル";
    await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
    expect(confirm).toHaveBeenCalledOnce(); expect(t.props.onCancel).not.toHaveBeenCalled(); expect(t.props.onReload).not.toHaveBeenCalled(); expect(t.props.onApply).not.toHaveBeenCalled();
    expect(createRenderedImage).not.toHaveBeenCalled(); expect(saveRenderedImage).not.toHaveBeenCalled();
    if (editor === 1) expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("180");
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("確認中の二重clickと別の破棄操作を抑止し、拒否後の再試行で1回だけ閉じる", async () => {
    const t = await setup(editor); t.rerender(<t.Component {...t.props} imageVersion={1} />);
    const pending = deferred(); const confirm = asyncConfirm(() => pending.promise);
    const cancel = screen.getByRole("button", { name: "キャンセル" });
    fireEvent.click(cancel); fireEvent.click(cancel); fireEvent.click(screen.getByRole("button", { name: "最新画像を読み直す" }));
    expect(confirm).toHaveBeenCalledOnce(); expect(t.props.onCancel).not.toHaveBeenCalled(); expect(t.props.onReload).not.toHaveBeenCalled();
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(false); });
    confirm.mockImplementation(() => Promise.resolve(true) as unknown as boolean);
    await act(async () => { fireEvent.click(cancel); });
    expect(t.props.onCancel).toHaveBeenCalledOnce(); expect(t.props.onReload).not.toHaveBeenCalled();
  });

  it("true確認後だけ再読み込みを1回開始し、完了待ちも二重操作しない", async () => {
    const t = await setup(editor); const pending = deferred(); const confirm = asyncConfirm(() => pending.promise);
    let finishReload!: () => void;
    t.props.onReload.mockImplementation(() => new Promise<void>(resolve => { finishReload = resolve; }));
    t.rerender(<t.Component {...t.props} imageVersion={1} />);
    const reload = screen.getByRole("button", { name: "最新画像を読み直す" }); fireEvent.click(reload);
    expect(t.props.onReload).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(true); });
    expect(t.props.onReload).toHaveBeenCalledOnce();
    fireEvent.click(reload); fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(confirm).toHaveBeenCalledOnce(); expect(t.props.onCancel).not.toHaveBeenCalled();
    await act(async () => { finishReload(); });
    expect((reload as HTMLButtonElement).disabled).toBe(false);
  });

  it("確認中に別対象へ切り替わると古いtrueを新旧の編集画面へ適用しない", async () => {
    const t = await setup(editor); const pending = deferred(); asyncConfirm(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    const next = baseProps(); next.target = { ...next.target, filename: "other.png", fullPath: "C:/fixture/other.png" };
    t.rerender(<t.Component {...next} />);
    await act(async () => { pending.resolve(true); });
    expect(t.props.onCancel).not.toHaveBeenCalled(); expect(next.onCancel).not.toHaveBeenCalled();
    expect(t.props.onReload).not.toHaveBeenCalled(); expect(next.onReload).not.toHaveBeenCalled();
  });

  it("確認後に編集が増えた場合は古いtrueで破棄しない", async () => {
    const t = await setup(editor); const pending = deferred(); asyncConfirm(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); await t.change();
    await act(async () => { pending.resolve(true); });
    expect(t.props.onCancel).not.toHaveBeenCalled(); expect(t.props.onReload).not.toHaveBeenCalled();
    if (editor === 1) expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("200");
  });

  it("unmount後の確認完了を無視する", async () => {
    const t = await setup(editor); const pending = deferred(); asyncConfirm(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); t.unmount();
    await act(async () => { pending.resolve(true); });
    expect(t.props.onCancel).not.toHaveBeenCalled(); expect(t.props.onReload).not.toHaveBeenCalled();
  });

  it("Escapeで閉じる場合もPromiseのfalseを待つ", async () => {
    const t = await setup(editor); const confirm = asyncConfirm(() => Promise.resolve(false));
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(confirm).toHaveBeenCalledOnce(); expect(t.props.onCancel).not.toHaveBeenCalled();
  });

  it("確認APIがrejectしても未処理例外にせず再試行できる", async () => {
    const t = await setup(editor); const confirm = asyncConfirm(() => Promise.reject(new Error("試験用確認失敗")));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); });
    expect(t.props.onCancel).not.toHaveBeenCalled();
    if (editor === 1) expect(t.props.onError).toHaveBeenCalledWith(expect.stringContaining("試験用確認失敗"));
    else expect(screen.getByRole("alert").textContent).toContain("試験用確認失敗");
    confirm.mockImplementation(() => Promise.resolve(true) as unknown as boolean);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); });
    expect(t.props.onCancel).toHaveBeenCalledOnce();
  });
});
