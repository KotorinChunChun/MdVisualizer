import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";

vi.mock("../lib/commands", () => ({
  saveRenderedImage: vi.fn(),
}));

const props = {
  target: { rawSrc: "asset://sample.png", fullPath: "C:\\docs\\sample.png", filename: "sample.png" },
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

describe("ImageAnnotationEditor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows independent tools, the color palette, and canvas scale controls", () => {
    const { container } = render(<ImageAnnotationEditor {...props} />);
    expect(screen.getByRole("dialog", { name: "画像編集: sample.png" })).toBeTruthy();
    for (const tool of ["選択", "四角", "楕円", "マスク", "ラベル"]) {
      expect(screen.getByRole("button", { name: new RegExp(tool) })).toBeTruthy();
    }
    expect(container.querySelectorAll(".annotation-editor__palette > button")).toHaveLength(4);
    const scale = container.querySelector(".annotation-editor__scale-controls input") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "キャンバスを拡大" }));
    expect(scale.value).toBe("110");
    fireEvent.change(scale, { target: { value: "75" } });
    expect(scale.value).toBe("75");
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
