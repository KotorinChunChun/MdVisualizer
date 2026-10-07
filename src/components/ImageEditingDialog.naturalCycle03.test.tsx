import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cases from "../../tests/fixtures/natural-cycle03-menu/cases.json";
import { ImageEditingDialog } from "./ImageEditingDialog";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";
import { RasterEditor2 } from "./RasterEditor2";
import { createRenderedImage, readImageForEdit, saveRenderedImage } from "../lib/commands";

vi.mock("../lib/commands", () => ({ readImageForEdit: vi.fn(), saveRenderedImage: vi.fn(), createRenderedImage: vi.fn() }));
vi.mock("../lib/rasterOutput", () => ({ saveRasterCopy: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(vi.fn()) }) }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(atob(png.split(",")[1]), char => char.charCodeAt(0));
const loadedSources: string[] = [];
const path = "C:/b03/M02/original.png";
const baseProps = () => ({ target: { rawSrc: "asset://original.png", fullPath: path, filename: "original.png", storage: "external" as const }, imageVersion: 0, onApply: vi.fn(), onCancel: vi.fn(), onError: vi.fn() });

function loadLegacy(container: HTMLElement) {
  const image = container.querySelector(".annotation-editor img") ?? container.querySelector("img");
  if (!(image instanceof HTMLImageElement)) throw new Error("編集画像がない");
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 160 }, naturalHeight: { configurable: true, value: 100 } });
  fireEvent.load(image);
  return image;
}
async function connectRaster2() {
  const frame = screen.getByTitle("ラスタ編集2画像編集") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fireEvent.load(frame);
  await waitFor(() => expect(post.mock.calls.some(([message]) => message.type === "load")).toBe(true));
  const session = post.mock.calls.find(([message]) => message.type === "load")![0].session;
  const emit = async (message: Record<string, unknown>) => act(async () => { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { channel: "mdv-image", session, ...message } })); });
  await emit({ type: "loaded" });
  return { post, emit };
}

beforeEach(() => {
  loadedSources.length = 0;
  vi.mocked(readImageForEdit).mockReset(); vi.mocked(saveRenderedImage).mockReset(); vi.mocked(createRenderedImage).mockReset();
  vi.stubGlobal("Image", class { naturalWidth = 160; naturalHeight = 100; onload?: () => void; set src(value: string) { loadedSources.push(value); queueMicrotask(() => this.onload?.()); } });
  const context = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (object, key) => key in object ? object[key as keyof typeof object] : vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => {
    const blob = new Blob([pngBytes], { type: "image/png" });
    Object.defineProperty(blob, "arrayBuffer", { value: async () => new Uint8Array(pngBytes).buffer });
    callback(blob);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });

describe("第3組メニュー: 素材の選び直しと新規保存競合（画素/実Rustは別受入）", () => {
  it.each([1, 2])("B03-M02 ラスタ編集%sは読込失敗後に選んだ素材を元対象へだけ保存する", async editor => {
    const files = new Map([[path, "元ファイル"], ["C:/b03/M02/replacement.png", "素材ファイル"]]);
    vi.mocked(readImageForEdit).mockRejectedValueOnce(new Error("試験用読込拒否"));
    vi.mocked(saveRenderedImage).mockImplementation(async request => {
      files.set(request.path, "選択素材からの保存結果");
      return { path: request.path, backup_available: true } as Awaited<ReturnType<typeof saveRenderedImage>>;
    });
    const props = baseProps(); const view = render(<ImageEditingDialog {...props} />);
    expect((await screen.findByRole("alert")).textContent).toContain("試験用読込拒否");
    fireEvent.click(screen.getByRole("button", { name: "画像を選び直す" }));
    const file = new File([pngBytes], cases.M02.replacement, { type: "image/png" });
    fireEvent.change(screen.getByLabelText("差し替える画像"), { target: { files: [file] } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(files.get(path)).toBe("元ファイル"); expect(files.get("C:/b03/M02/replacement.png")).toBe("素材ファイル");
    fireEvent.click(screen.getByRole("button", { name: `ラスタ編集${editor}` }));
    if (editor === 1) {
      const image = loadLegacy(view.container); expect(image.src).toBe(png);
      fireEvent.change(screen.getByLabelText("幅 (dot)"), { target: { value: "180" } });
      fireEvent.click(screen.getByRole("button", { name: "保存して閉じる" }));
    } else {
      const t = await connectRaster2(); expect(loadedSources).toContain(png);
      await t.emit({ type: "changed", dirty: true });
      fireEvent.click(screen.getByRole("button", { name: "保存して閉じる" }));
      const request = t.post.mock.calls.find(([message]) => message.type === "render")![0].request;
      await t.emit({ type: "result", request, dataUri: png });
    }
    await waitFor(() => expect(props.onApply).toHaveBeenCalledOnce());
    expect(saveRenderedImage).toHaveBeenCalledOnce();
    expect(saveRenderedImage).toHaveBeenCalledWith(expect.objectContaining({ path }));
    expect(createRenderedImage).not.toHaveBeenCalled(); expect(props.onError).not.toHaveBeenCalled();
    expect(files.get(path)).toBe("選択素材からの保存結果"); expect(files.get("C:/b03/M02/replacement.png")).toBe("素材ファイル");
    // ファイルmapはIPC契約の観測用。実ファイル不変・画素一致の受入ではない。
  });

  it.each([1, 2])("B03-M03 ラスタ編集%sの新規作成衝突は保存完了を通知せず編集を保持する", async editor => {
    vi.mocked(createRenderedImage).mockRejectedValue(new Error("試験用排他作成拒否: ファイルが存在します"));
    const props = { ...baseProps(), target: { rawSrc: png, fullPath: "C:/b03/M03/new.png", filename: "new.png", storage: "external" as const, createNew: true }, enableNativeDragDrop: false };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    if (editor === 1) {
      const view = render(<ImageAnnotationEditor {...props} />); loadLegacy(view.container);
      fireEvent.change(screen.getByLabelText("幅 (dot)"), { target: { value: "420" } });
      fireEvent.click(screen.getByRole("button", { name: "保存して閉じる" }));
      await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.stringContaining("ファイルが存在します")));
      expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("420");
      expect((screen.getByRole("button", { name: "元に戻す" }) as HTMLButtonElement).disabled).toBe(false);
    } else {
      render(<RasterEditor2 {...props} />); const t = await connectRaster2(); await t.emit({ type: "changed", dirty: true });
      fireEvent.click(screen.getByRole("button", { name: "保存して閉じる" }));
      const request = t.post.mock.calls.find(([message]) => message.type === "render")![0].request;
      await t.emit({ type: "result", request, dataUri: png });
      expect((await screen.findByRole("alert")).textContent).toContain("ファイルが存在します");
    }
    expect(createRenderedImage).toHaveBeenCalledOnce(); expect(saveRenderedImage).not.toHaveBeenCalled();
    expect(props.onApply).not.toHaveBeenCalled(); expect(props.onCancel).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "保存して閉じる" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(confirm).toHaveBeenCalled(); expect(props.onCancel).not.toHaveBeenCalled();
    // 排他createの実装自体はRust既存テスト/nativeへ。ここは拒否応答後の実editor状態。
  });
});
