import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";
import { RasterEditor2 } from "./RasterEditor2";
import { copyMermaid } from "../lib/mermaidClipboard";
import { readImageForEdit, saveRenderedImage } from "../lib/commands";

vi.mock("../lib/mermaidClipboard", () => ({ copyMermaid: vi.fn(), copyMermaidAsFile: vi.fn() }));
vi.mock("../lib/commands", () => ({ readImageForEdit: vi.fn(), saveRenderedImage: vi.fn(), createRenderedImage: vi.fn() }));
vi.mock("../lib/rasterOutput", () => ({ saveRasterCopy: vi.fn() }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const target = { rawSrc: png, filename: "original.png", fullPath: "C:/natural-cycle02/original.png", storage: "external" as const };
beforeEach(() => {
  vi.stubGlobal("Image", class { naturalWidth = 160; naturalHeight = 100; onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()); } async decode() {} });
  const context = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (object, key) => key in object ? object[key as keyof typeof object] : vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
  vi.mocked(readImageForEdit).mockResolvedValue(png);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });
describe("第2組の自然操作: コピーとラスタ編集の失敗回復", () => {
  it("B02-M12 図コピーの画像書込み失敗後、再操作だけ成功通知とBMP出力になる", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    let copied: string | null = null;
    vi.mocked(copyMermaid).mockRejectedValueOnce(new Error("試験クリップボード書込み拒否")).mockImplementationOnce(async (format, _source, svg) => { copied = `${format}:${svg}`; });
    const notices: { type: string; message: string }[] = [];
    const toast = (event: Event) => notices.push((event as CustomEvent).detail);
    window.addEventListener("markdown-toast", toast);
    try {
      const content = "![図](original.png)"; const changed = vi.fn();
      render(<MarkdownPreview content={content} baseDir="C:/natural-cycle02" documentPath="C:/natural-cycle02/menu.md" imageVersions={{}} onTextEdit={changed} />);
      fireEvent.contextMenu(screen.getByAltText("図")); fireEvent.click(screen.getByRole("menuitem", { name: "図としてコピー" }));
      await waitFor(() => expect(notices).toHaveLength(1)); expect(notices[0]).toMatchObject({ type: "error" }); expect(copied).toBeNull();
      fireEvent.contextMenu(screen.getByAltText("図")); fireEvent.click(screen.getByRole("menuitem", { name: "図としてコピー" }));
      await waitFor(() => expect(notices).toHaveLength(2)); expect(notices[1]).toMatchObject({ type: "success", message: "図をビットマップでコピーしました" });
      expect(copyMermaid).toHaveBeenCalledTimes(2); expect(copyMermaid).toHaveBeenLastCalledWith("bmp", "", expect.stringContaining(png));
      expect(readImageForEdit).toHaveBeenCalledWith("C:/natural-cycle02/original.png"); expect(copied).toContain("bmp:");
      expect(changed).not.toHaveBeenCalled(); expect(saveRenderedImage).not.toHaveBeenCalled();
    } finally { window.removeEventListener("markdown-toast", toast); }
  });
  it("B02-M13 ラスタ編集1の競合読み直し取消は編集を保持し、再確認後だけ再読込する", async () => {
    const props = { target, imageVersion: 0, onApply: vi.fn(), onCancel: vi.fn(), onError: vi.fn(), onReload: vi.fn().mockResolvedValue(undefined), enableNativeDragDrop: false };
    const view = render(<ImageAnnotationEditor {...props} />);
    const img = view.container.querySelector("img")!;
    Object.defineProperties(img, { naturalWidth: { value: 160 }, naturalHeight: { value: 100 } }); fireEvent.load(img);
    fireEvent.change(screen.getByLabelText("幅 (dot)"), { target: { value: "420" } });
    expect((screen.getByRole("button", { name: "保存して閉じる" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<ImageAnnotationEditor {...props} imageVersion={1} />);
    const confirm = vi.spyOn(window, "confirm")
      .mockImplementationOnce(() => Promise.resolve(false) as unknown as boolean)
      .mockImplementationOnce(() => Promise.resolve(true) as unknown as boolean);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "最新画像を読み直す" })); });
    expect(props.onReload).not.toHaveBeenCalled(); expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("420");
    expect((screen.getByRole("button", { name: "元に戻す" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "保存して閉じる" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "最新画像を読み直す" })); }); expect(confirm).toHaveBeenCalledTimes(2); expect(props.onReload).toHaveBeenCalledOnce();
    expect(props.onApply).not.toHaveBeenCalled(); expect(saveRenderedImage).not.toHaveBeenCalled();
  });
  it("B02-M13 ラスタ編集2も競合取消後はdirtyを保持し、再確認後だけ再読込する", async () => {
    const props = { target, imageVersion: 0, onApply: vi.fn(), onCancel: vi.fn(), onError: vi.fn(), onReload: vi.fn().mockResolvedValue(undefined) };
    const view = render(<RasterEditor2 {...props} />);
    const frame = screen.getByTitle("ラスタ編集2画像編集") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage"); fireEvent.load(frame);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const session = post.mock.calls.find(([message]) => message.type === "load")![0].session;
    await act(async () => { for (const message of [{ type: "loaded" }, { type: "changed", dirty: true }]) window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { channel: "mdv-image", session, ...message } })); });
    view.rerender(<RasterEditor2 {...props} imageVersion={1} />);
    const confirm = vi.spyOn(window, "confirm").mockImplementation(() => Promise.resolve(false) as unknown as boolean);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "最新画像を読み直す" })); }); expect(props.onReload).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); }); expect(confirm).toHaveBeenLastCalledWith("編集内容を反映せずに閉じますか？"); expect(props.onCancel).not.toHaveBeenCalled();
    confirm.mockImplementation(() => Promise.resolve(true) as unknown as boolean);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "最新画像を読み直す" })); });
    expect(props.onReload).toHaveBeenCalledOnce(); expect(props.onApply).not.toHaveBeenCalled(); expect(saveRenderedImage).not.toHaveBeenCalled();
    expect(post.mock.calls.filter(([message]) => message.type === "render")).toHaveLength(0);
  });
});
