import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";

vi.mock("../lib/commands", () => ({
  saveRenderedImage: vi.fn(),
  createRenderedImage: vi.fn(),
  readImageForEdit: vi.fn(async () => "data:image/png;base64,c2FmZQ=="),
}));

const tauriDrop = vi.hoisted(() => ({
  callback: null as ((event: { payload: { type: string; paths: string[] } }) => void) | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (callback: (event: { payload: { type: string; paths: string[] } }) => void) => {
      tauriDrop.callback = callback;
      return Promise.resolve(vi.fn());
    },
  }),
}));

const props = {
  target: { rawSrc: "asset://sample.png", fullPath: "C:\\docs\\sample.png", filename: "sample.png", storage: "external" as const },
  imageVersion: 0,
  onApply: vi.fn(),
  onCancel: vi.fn(),
  onError: vi.fn(),
};

function editorCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector("canvas")!;
  canvas.width = 1000;
  canvas.height = 800;
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150, toJSON: () => ({}) }),
  });
  Object.defineProperty(canvas, "setPointerCapture", { value: vi.fn() });
  Object.defineProperty(canvas, "releasePointerCapture", { value: vi.fn() });
  Object.defineProperty(canvas, "hasPointerCapture", { value: () => false });
  return canvas;
}

function loadEditorImage(container: HTMLElement, width = 320, height = 240): void {
  const image = container.querySelector("img")!;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
}

describe("ImageAnnotationEditor", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    tauriDrop.callback = null;
    localStorage.clear();
  });

  it("shows independent tools, the color palette, and canvas dot controls", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    loadEditorImage(container);
    expect(screen.getByRole("dialog", { name: "画像編集: sample.png" })).toBeTruthy();
    for (const tool of ["選択", "鉛筆", "ブラシ", "消しゴム", "塗りつぶし", "スポイト", "線", "四角", "楕円", "矢印", "マスク", "ラベル", "切り抜き"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${tool}$`) })).toBeTruthy();
    }
    for (const action of ["左へ90°回転", "右へ90°回転", "左右反転", "上下反転", "画像をリサイズ"]) {
      expect(screen.getByRole("button", { name: action })).toBeTruthy();
    }
    expect(container.querySelectorAll(".annotation-editor__palette > button")).toHaveLength(4);
    expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("320");
    expect((screen.getByLabelText("高さ (dot)") as HTMLInputElement).value).toBe("240");
    expect(container.querySelector(".annotation-editor__scale-controls")).toBeNull();
  });

  it("can skip Tauri native drag-drop registration for browser hosts", () => {
    render(<ImageAnnotationEditor {...props} enableNativeDragDrop={false} />);
    expect(tauriDrop.callback).toBeNull();
  });

  it("uses two-dot stamp inputs and exposes all arrow directions", () => {
    render(<ImageAnnotationEditor {...props} />);
    expect((screen.getByLabelText("幅") as HTMLInputElement).step).toBe("2");
    expect((screen.getByLabelText("高さ") as HTMLInputElement).step).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: /矢印/ }));
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe("240");
    expect((screen.getByLabelText("高さ") as HTMLInputElement).value).toBe("80");
    expect((screen.getByLabelText("向き") as HTMLSelectElement).options).toHaveLength(8);
  });

  it("resizes actual canvas dots by dragging any side handle", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    loadEditorImage(container);
    editorCanvas(container);
    const canvasWidth = screen.getByLabelText("幅 (dot)") as HTMLInputElement;
    const canvasHeight = screen.getByLabelText("高さ (dot)") as HTMLInputElement;
    const rightHandle = screen.getByRole("button", { name: "右辺をドラッグしてキャンバスサイズを変更" });
    fireEvent.pointerDown(rightHandle, { pointerId: 10, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(rightHandle, { pointerId: 10, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(rightHandle, { pointerId: 10, clientX: 200, clientY: 100 });
    expect(canvasWidth.value).toBe("420");
    expect(canvasHeight.value).toBe("240");

    const topHandle = screen.getByRole("button", { name: "上辺をドラッグしてキャンバスサイズを変更" });
    fireEvent.pointerDown(topHandle, { pointerId: 11, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(topHandle, { pointerId: 11, clientX: 100, clientY: 180 });
    fireEvent.pointerUp(topHandle, { pointerId: 11, clientX: 100, clientY: 180 });
    expect(canvasWidth.value).toBe("420");
    expect(canvasHeight.value).toBe("160");
  });

  it("enables applying a centered numeric canvas expansion without annotations", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    loadEditorImage(container);
    const apply = screen.getByRole("button", { name: "適用" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("幅 (dot)"), { target: { value: "420" } });
    expect(apply.disabled).toBe(false);
  });

  it("loads a pasted replacement path and keeps canvas margins around its dimensions", async () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    loadEditorImage(container);
    fireEvent.change(screen.getByLabelText("幅 (dot)"), { target: { value: "420" } });
    const pathInput = screen.getByLabelText("代わりの画像パス");
    fireEvent.paste(pathInput, { clipboardData: { getData: () => "C:\\images\\new.png" } });
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,c2FmZQ=="));
    loadEditorImage(container, 640, 480);
    expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("740");
    expect((screen.getByLabelText("高さ (dot)") as HTMLInputElement).value).toBe("480");
    expect(screen.getByText("差し替え候補: C:\\images\\new.png")).toBeTruthy();
  });

  it("accepts pasted and HTML-dropped image File objects", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:pasted").mockReturnValueOnce("blob:dropped");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { container } = render(<ImageAnnotationEditor {...props} />);
    loadEditorImage(container);
    const pasted = new File(["image"], "pasted.png", { type: "image/png" });
    fireEvent.paste(window, { clipboardData: { files: [pasted], getData: () => "" } });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:pasted");

    const dropped = new File(["image"], "dropped.webp", { type: "image/webp" });
    fireEvent.drop(container.querySelector(".annotation-editor__stage")!, {
      dataTransfer: { files: [dropped], types: ["Files"], getData: () => "" },
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:dropped");
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("accepts an image path from the Tauri native drop event", async () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    loadEditorImage(container);
    await waitFor(() => expect(tauriDrop.callback).not.toBeNull());
    act(() => tauriDrop.callback?.({ payload: { type: "drop", paths: ["C:\\images\\native.jpg"] } }));
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,c2FmZQ=="));
  });

  it("changes stamp height with the wheel and width with Shift+wheel", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    const width = screen.getByLabelText("幅") as HTMLInputElement;
    const height = screen.getByLabelText("高さ") as HTMLInputElement;
    fireEvent.wheel(canvas, { deltaY: -100 });
    expect(height.value).toBe("182");
    expect(width.value).toBe("320");
    fireEvent.wheel(canvas, { deltaY: 100, shiftKey: true });
    expect(width.value).toBe("318");
  });

  it("switches frames to rounded corners and rotates a selected stamp with accelerated Alt+wheel", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.click(screen.getByLabelText("角丸四角形"));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });
    const angle = screen.getByLabelText("角度") as HTMLInputElement;
    expect(angle.value).toBe("0");
    fireEvent.wheel(canvas, { deltaY: -100, altKey: true, timeStamp: 100 });
    expect(angle.value).toBe("2");
    fireEvent.wheel(canvas, { deltaY: -100, altKey: true, timeStamp: 200 });
    expect(angle.value).toBe("4");
    fireEvent.wheel(canvas, { deltaY: -100, altKey: true, timeStamp: 250 });
    expect(angle.value).toBe("14");
  });

  it("shows shortcut help and persists wheel step settings", () => {
    render(<ImageAnnotationEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByRole("dialog", { name: "画像編集設定" })).toBeTruthy();
    expect(screen.getByText("Alt+ホイール")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("通常の変化量"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("高速時の変化量"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
    expect(JSON.parse(localStorage.getItem("mdvisualizer.image-editor-settings.v1") ?? "{}")).toMatchObject({
      normalWheelStep: 3,
      fastWheelStep: 12,
    });
  });

  it("uses rectangular blur masks and a font-sized label default", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.click(screen.getByRole("button", { name: /マスク/ }));
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe("320");
    expect((screen.getByLabelText("高さ") as HTMLInputElement).value).toBe("120");
    expect((screen.getByLabelText("方式") as HTMLSelectElement).value).toBe("blur");

    fireEvent.click(screen.getByRole("button", { name: /ラベル/ }));
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe("200");
    expect((screen.getByLabelText("高さ") as HTMLInputElement).value).toBe("48");
    fireEvent.change(screen.getByLabelText("フォントサイズ"), { target: { value: "40" } });
    expect((screen.getByLabelText("高さ") as HTMLInputElement).value).toBe("56");
    fireEvent.wheel(canvas, { deltaY: -100 });
    expect((screen.getByLabelText("高さ") as HTMLInputElement).value).toBe("58");
    fireEvent.wheel(canvas, { deltaY: 100, shiftKey: true });
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe("198");
  });

  it("places and deletes a selected item with the Delete key", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    const apply = screen.getByRole("button", { name: "適用" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });
    expect(apply.disabled).toBe(false);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(apply.disabled).toBe(true);
  });

  it("records a freehand pencil stroke in undo history", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.click(screen.getByRole("button", { name: /^鉛筆$/ }));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 31, clientX: 30, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 31, clientX: 80, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 31, clientX: 120, clientY: 80 });
    expect((screen.getByRole("button", { name: "元に戻す" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "適用" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect((screen.getByRole("button", { name: "適用" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("returns edited embedded images as a PNG data URI without calling the file saver", async () => {
    const context = { drawImage: vi.fn(), canvas: { width: 0, height: 0 } };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
    const onApply = vi.fn();
    const { container } = render(<ImageAnnotationEditor
      {...props}
      target={{ rawSrc: "data:image/png;base64,AAAA", filename: "embedded.png", storage: "embedded" }}
      onApply={onApply}
    />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    loadEditorImage(container);
    fireEvent.change(screen.getByLabelText("幅 (dot)"), { target: { value: "321" } });
    fireEvent.click(screen.getByRole("button", { name: "適用" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      filename: "embedded.png",
      backupAvailable: false,
      dataUri: "data:image/png;base64,cG5n",
    })));
    const { saveRenderedImage } = await import("../lib/commands");
    expect(saveRenderedImage).not.toHaveBeenCalled();
  });

  it("renders a rounded and rotated stamp into the saved PNG", async () => {
    const rotate = vi.fn();
    const roundRect = vi.fn();
    const context = {
      canvas: { width: 1000, height: 800 }, drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
      translate: vi.fn(), rotate, strokeRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
      roundRect, rect: vi.fn(), stroke: vi.fn(), strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
    const onApply = vi.fn();
    const { container } = render(<ImageAnnotationEditor
      {...props}
      target={{ rawSrc: "data:image/png;base64,AAAA", filename: "embedded.png", storage: "embedded" }}
      onApply={onApply}
    />);
    loadEditorImage(container, 1000, 800);
    const canvas = editorCanvas(container);
    fireEvent.click(screen.getByLabelText("角丸四角形"));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });
    fireEvent.wheel(canvas, { deltaY: -100, altKey: true, timeStamp: 100 });
    fireEvent.click(screen.getByRole("button", { name: "適用" }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(rotate).toHaveBeenCalledWith(2 * Math.PI / 180);
    expect(roundRect).toHaveBeenCalled();
  });

  it("returns edited SharePoint images as PNG data without calling the local file saver", async () => {
    const context = { drawImage: vi.fn(), canvas: { width: 0, height: 0 } };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<ImageAnnotationEditor
      {...props}
      target={{
        rawSrc: "data:image/png;base64,AAAA",
        filename: "sharepoint.png",
        storage: "sharepoint",
        sharePoint: {
          documentPath: "spmd://contoso.sharepoint.com/sites/docs/Shared/readme.md",
          source: "sharepoint.png",
          path: "spmd://contoso.sharepoint.com/sites/docs/Shared/sharepoint.png",
          revision: "etag-1",
          mediaType: "image/png",
        },
      }}
      onApply={onApply}
    />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    loadEditorImage(container);
    fireEvent.change(screen.getByLabelText("幅 (dot)"), { target: { value: "321" } });
    fireEvent.click(screen.getByRole("button", { name: "適用" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      filename: "sharepoint.png",
      backupAvailable: false,
      dataUri: "data:image/png;base64,cG5n",
    })));
    const { saveRenderedImage } = await import("../lib/commands");
    expect(saveRenderedImage).not.toHaveBeenCalled();
  });

  it("undoes and redoes a rotation together with its canvas dimensions", async () => {
    const context = { drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), canvas: { width: 0, height: 0 } };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ROTATED");
    const { container } = render(<ImageAnnotationEditor {...props} />);
    loadEditorImage(container, 320, 240);
    const canvas = container.querySelector("canvas")!;
    canvas.width = 320;
    canvas.height = 240;
    fireEvent.click(screen.getByRole("button", { name: "右へ90°回転" }));
    expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("240");
    expect((screen.getByLabelText("高さ (dot)") as HTMLInputElement).value).toBe("320");
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("320");
    expect((screen.getByLabelText("高さ (dot)") as HTMLInputElement).value).toBe("240");
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect((screen.getByLabelText("幅 (dot)") as HTMLInputElement).value).toBe("240");
  });

  it("opens the custom menu and enables paste after copying", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });
    fireEvent.contextMenu(canvas, { clientX: 150, clientY: 75 });
    const copy = screen.getByRole("menuitem", { name: "コピー" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(false);
    fireEvent.click(copy);
    fireEvent.contextMenu(canvas, { clientX: 150, clientY: 75 });
    expect((screen.getByRole("menuitem", { name: "貼り付け" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses the first outside click after placement only to clear selection", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("高さ"), { target: { value: "40" } });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 30, clientY: 20 });
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect((screen.getByRole("button", { name: "適用" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not switch selection to an existing item while a stamp tool is active", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("高さ"), { target: { value: "40" } });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 30, clientY: 20 });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 3, clientX: 150, clientY: 75 });
    fireEvent.keyDown(window, { key: "Delete" });
    expect((screen.getByRole("button", { name: "適用" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("cuts the selection with Ctrl+X and makes it available for paste", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect((screen.getByRole("button", { name: "適用" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.contextMenu(canvas, { clientX: 20, clientY: 20 });
    expect((screen.getByRole("menuitem", { name: "貼り付け" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("moves a selected item by dragging and commits the new hit area", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    const canvas = editorCanvas(container);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("高さ"), { target: { value: "40" } });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 150, clientY: 75 });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 150, clientY: 75 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 180, clientY: 90 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 180, clientY: 90 });

    fireEvent.contextMenu(canvas, { clientX: 150, clientY: 75 });
    expect((screen.getByRole("menuitem", { name: "コピー" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.pointerDown(window);
    fireEvent.contextMenu(canvas, { clientX: 180, clientY: 90 });
    expect((screen.getByRole("menuitem", { name: "コピー" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
