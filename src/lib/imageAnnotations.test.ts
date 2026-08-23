import { describe, expect, it, vi } from "vitest";
import {
  clamp,
  clampAnnotation,
  clampRect,
  createImageAnnotationState,
  duplicateImageAnnotation,
  drawImageAnnotations,
  hitTestAnnotation,
  imageAnnotationReducer,
  normalizeAnnotationRotation,
  type FrameAnnotation,
  type ArrowAnnotation,
  type ImageAnnotation,
  type MaskAnnotation,
} from "./imageAnnotations";

const bounds = { width: 100, height: 80 };
const frame = (id = "frame"): FrameAnnotation => ({
  id, type: "frame", x: 10, y: 20, width: 30, height: 20, color: "#d00", lineWidth: 3,
});
const solidMask = (): MaskAnnotation => ({
  id: "mask", type: "mask", x: 0, y: 0, width: 2, height: 2, style: "solid", color: "#000",
});
const arrow = (): ArrowAnnotation => ({
  id: "arrow", type: "arrow", x: 10, y: 20, width: 30, height: 20, color: "#d00", lineWidth: 3, direction: "right",
});

describe("image annotation geometry", () => {
  it("clamps scalar and drag rectangles to image bounds", () => {
    expect(clamp(Number.NaN, 2, 4)).toBe(2);
    expect(clamp(9, 4, 2)).toBe(4);
    expect(clampRect({ x: 90, y: 70, width: 20, height: 20 }, bounds)).toEqual({ x: 90, y: 70, width: 10, height: 10 });
    expect(clampRect({ x: 30, y: 20, width: -40, height: -30 }, bounds)).toEqual({ x: 0, y: 0, width: 30, height: 20 });
  });

  it("clamps type-specific annotation values", () => {
    expect(clampAnnotation({ ...frame(), x: -5, width: 200, lineWidth: 0, cornerRadius: 80, rotation: 450 }, bounds)).toMatchObject({ x: 0, width: 100, lineWidth: 1, cornerRadius: 10, rotation: 90 });
    expect(clampAnnotation({ id: "l", type: "label", x: 0, y: 0, width: 2, height: 2, text: "x", textColor: "#fff", backgroundColor: "#000", fontSize: 0 }, bounds)).toMatchObject({ fontSize: 1 });
    expect(normalizeAnnotationRotation(-540)).toBe(-180);
  });

  it("returns the uppermost annotation hit", () => {
    const top = { ...frame("top"), color: "#000" };
    expect(hitTestAnnotation([frame(), top], 20, 25)?.id).toBe("top");
    expect(hitTestAnnotation([frame()], 99, 25)).toBeUndefined();
  });

  it("uses ellipse geometry for ellipse hit testing", () => {
    const ellipse = { ...frame("ellipse"), type: "ellipse" as const };
    expect(hitTestAnnotation([ellipse], 25, 30)?.id).toBe("ellipse");
    expect(hitTestAnnotation([ellipse], 10, 20)).toBeUndefined();
  });

  it("hit-tests an arrow along its shaft instead of its whole bounding box", () => {
    expect(hitTestAnnotation([arrow()], 25, 30)?.id).toBe("arrow");
    expect(hitTestAnnotation([arrow()], 25, 20)).toBeUndefined();
  });

  it("hit-tests rounded corners and rotated stamp coordinates", () => {
    expect(hitTestAnnotation([{ ...frame(), cornerRadius: 8 }], 10, 20)).toBeUndefined();
    expect(hitTestAnnotation([{ ...frame(), cornerRadius: 8 }], 18, 20)?.id).toBe("frame");
    expect(hitTestAnnotation([{ ...frame(), rotation: 90 }], 25, 44)?.id).toBe("frame");
    expect(hitTestAnnotation([{ ...frame(), rotation: 90 }], 39, 30)).toBeUndefined();
  });

  it("duplicates an annotation with a new identity and bounded offset", () => {
    expect(duplicateImageAnnotation({ ...frame(), cornerRadius: 9, rotation: 24 }, "copy", 16, bounds)).toMatchObject({
      id: "copy", x: 26, y: 36, width: 30, height: 20, cornerRadius: 9, rotation: 24,
    });
    expect(duplicateImageAnnotation({ ...frame(), x: 80, y: 70 }, "edge", 16, bounds)).toMatchObject({
      id: "edge", x: 96, y: 80, width: 4, height: 0,
    });
  });
});

describe("image annotation reducer", () => {
  it("resets an edit session when an external image is accepted", () => {
    let state = imageAnnotationReducer(createImageAnnotationState(), {
      type: "place",
      annotation: frame(),
    });
    state = imageAnnotationReducer(state, { type: "reset" });
    expect(state).toEqual(createImageAnnotationState());
  });

  it("keeps a placed annotation selected and records one history entry", () => {
    const state = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame(), bounds });
    expect(state.annotations).toHaveLength(1);
    expect(state.selectedId).toBe("frame");
    expect(state.undoStack).toHaveLength(1);
  });

  it("does not put selection or selection commit in history", () => {
    const initial = createImageAnnotationState([frame(), frame("other")]);
    const selected = imageAnnotationReducer(initial, { type: "select", id: "other" });
    const committed = imageAnnotationReducer(selected, { type: "commitSelection" });
    expect(committed.undoStack).toHaveLength(0);
    expect(committed.selectedId).toBeNull();
  });

  it("updates, undoes, and redoes an annotation", () => {
    const placed = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame() });
    const updated = imageAnnotationReducer(placed, { type: "update", changes: { color: "#000", width: 44 } });
    expect(updated.annotations[0]).toMatchObject({ color: "#000", width: 44 });
    const undone = imageAnnotationReducer(updated, { type: "undo" });
    expect(undone.annotations[0]).toMatchObject({ color: "#d00", width: 30 });
    expect(imageAnnotationReducer(undone, { type: "redo" }).annotations[0]).toMatchObject({ color: "#000", width: 44 });
  });

  it("keeps frame shape and rotation through undo and redo", () => {
    const placed = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame() });
    const updated = imageAnnotationReducer(placed, { type: "update", changes: { cornerRadius: 8, rotation: 35 } });
    expect(updated.annotations[0]).toMatchObject({ cornerRadius: 8, rotation: 35 });
    const undone = imageAnnotationReducer(updated, { type: "undo" });
    expect(undone.annotations[0]).not.toHaveProperty("cornerRadius");
    expect(undone.annotations[0]).not.toHaveProperty("rotation");
    expect(imageAnnotationReducer(undone, { type: "redo" }).annotations[0]).toMatchObject({ cornerRadius: 8, rotation: 35 });
  });

  it("restores a deleted selected annotation through undo", () => {
    const placed = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame() });
    const deleted = imageAnnotationReducer(placed, { type: "delete" });
    expect(deleted.annotations).toEqual([]);
    expect(deleted.selectedId).toBeNull();
    expect(imageAnnotationReducer(deleted, { type: "undo" }).annotations).toHaveLength(1);
  });

  it("clears redo history when making a new edit", () => {
    const placed = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame() });
    const undone = imageAnnotationReducer(placed, { type: "undo" });
    const replaced = imageAnnotationReducer(undone, { type: "place", annotation: frame("new") });
    expect(replaced.redoStack).toEqual([]);
  });

  it("scales the selected annotation around its center and clamps when requested", () => {
    const placed = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame() });
    const scaled = imageAnnotationReducer(placed, { type: "scaleSelected", scale: 2 });
    expect(scaled.annotations[0]).toMatchObject({ x: -5, y: 10, width: 60, height: 40 });
    const clamped = imageAnnotationReducer(scaled, { type: "scaleSelected", scale: 4, bounds });
    expect(clamped.annotations[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 80 });
  });

  it("resizes one selected axis symmetrically around its center", () => {
    const placed = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame() });
    const taller = imageAnnotationReducer(placed, { type: "resizeSelected", axis: "height", delta: 2, bounds });
    expect(taller.annotations[0]).toMatchObject({ x: 10, y: 19, width: 30, height: 22 });
    const narrower = imageAnnotationReducer(taller, { type: "resizeSelected", axis: "width", delta: -2, bounds });
    expect(narrower.annotations[0]).toMatchObject({ x: 11, y: 19, width: 28, height: 22 });
  });

  it("ignores edits without a selected target", () => {
    const state = createImageAnnotationState([frame()]);
    expect(imageAnnotationReducer(state, { type: "delete" })).toBe(state);
    expect(imageAnnotationReducer(state, { type: "scaleSelected", scale: 2 })).toBe(state);
    expect(imageAnnotationReducer(state, { type: "resizeSelected", axis: "height", delta: 2 })).toBe(state);
  });

  it("translates current annotations and history together for canvas origin changes", () => {
    const placed = imageAnnotationReducer(createImageAnnotationState(), { type: "place", annotation: frame() });
    const moved = imageAnnotationReducer(placed, { type: "translateAll", x: 12, y: 8 });
    expect(moved.annotations[0]).toMatchObject({ x: 22, y: 28 });
    expect(moved.undoStack[0]).toEqual([]);
    expect(imageAnnotationReducer(moved, { type: "undo" }).annotations).toEqual([]);
  });
});

class FakeContext {
  canvas = { width: 4, height: 2 };
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  font = "";
  textBaseline: CanvasTextBaseline = "alphabetic";
  calls: string[] = [];
  pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255,
    0, 0, 0, 255, 50, 50, 50, 255, 100, 100, 100, 255, 150, 150, 150, 255,
  ]);
  save() { this.calls.push("save"); }
  restore() { this.calls.push("restore"); }
  translate() { this.calls.push("translate"); }
  rotate() { this.calls.push("rotate"); }
  fillRect() { this.calls.push("fillRect"); }
  strokeRect() { this.calls.push("strokeRect"); }
  fillText() { this.calls.push("fillText"); }
  beginPath() { this.calls.push("beginPath"); }
  rect() { this.calls.push("rect"); }
  roundRect() { this.calls.push("roundRect"); }
  ellipse() { this.calls.push("ellipse"); }
  moveTo() { this.calls.push("moveTo"); }
  lineTo() { this.calls.push("lineTo"); }
  stroke() { this.calls.push("stroke"); }
  getImageData(x: number, y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) data.set(this.pixels.slice(((y + row) * this.canvas.width + x) * 4, ((y + row) * this.canvas.width + x + width) * 4), row * width * 4);
    return { data, width, height } as ImageData;
  }
  putImageData(imageData: ImageData, x: number, y: number) {
    for (let row = 0; row < imageData.height; row += 1) this.pixels.set(imageData.data.slice(row * imageData.width * 4, (row + 1) * imageData.width * 4), ((y + row) * this.canvas.width + x) * 4);
  }
}

describe("image annotation drawing", () => {
  it("draws solid masks, frames, and labels in their proper canvas layers", () => {
    const ctx = new FakeContext();
    const annotations: ImageAnnotation[] = [
      solidMask(), frame(), { id: "label", type: "label", x: 0, y: 0, width: 3, height: 2, text: "A", textColor: "#fff", backgroundColor: "#333", fontSize: 12 },
    ];
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, annotations);
    expect(ctx.calls).toContain("fillRect");
    expect(ctx.calls).toContain("strokeRect");
    expect(ctx.calls).toContain("fillText");
  });

  it("draws an ellipse frame", () => {
    const ctx = new FakeContext();
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [{ ...frame(), type: "ellipse" }]);
    expect(ctx.calls).toEqual(expect.arrayContaining(["beginPath", "ellipse", "stroke"]));
  });

  it("draws a rounded frame with its saved rotation", () => {
    const ctx = new FakeContext();
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [{ ...frame(), x: 0, y: 0, width: 4, height: 2, cornerRadius: 1, rotation: 30 }]);
    expect(ctx.calls).toEqual(expect.arrayContaining(["translate", "rotate", "roundRect", "stroke"]));
  });

  it("draws an arrow shaft and arrowhead", () => {
    const ctx = new FakeContext();
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [arrow()]);
    expect(ctx.calls.filter((call) => call === "lineTo")).toHaveLength(3);
    expect(ctx.calls).toEqual(expect.arrayContaining(["beginPath", "moveTo", "stroke"]));
  });

  it("draws lines and freehand strokes", () => {
    const ctx = new FakeContext();
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [
      { id: "line", type: "line", x: 0, y: 0, width: 3, height: 1, color: "#f00", lineWidth: 2, reverse: false },
      { id: "stroke", type: "stroke", mode: "brush", x: 0, y: 0, width: 3, height: 1, color: "#0f0", lineWidth: 3, points: [{ x: 0, y: 0 }, { x: 3, y: 1 }] },
    ]);
    expect(ctx.calls.filter((call) => call === "stroke")).toHaveLength(2);
  });

  it("flood fills only the connected matching colour", () => {
    const ctx = new FakeContext();
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [
      { id: "fill", type: "fill", x: 0, y: 0, width: 1, height: 1, color: "#112233", tolerance: 0 },
    ]);
    expect(Array.from(ctx.pixels.slice(0, 4))).toEqual([17, 34, 51, 255]);
    expect(Array.from(ctx.pixels.slice(4, 8))).toEqual([0, 0, 255, 255]);
  });

  it("blurs image pixels inside a mask", () => {
    const ctx = new FakeContext();
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [{ ...solidMask(), style: "blur", width: 4, height: 1 }]);
    expect(ctx.pixels[0]).toBeGreaterThan(0);
    expect(ctx.pixels[0]).toBeLessThan(255);
    expect(ctx.pixels[4]).toBeGreaterThan(0);
  });

  it("uses native canvas filtering for browser blur masks without reading pixels", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 80;
    const scratchContext = { drawImage: vi.fn(), imageSmoothingEnabled: true };
    const scratch = document.createElement("canvas");
    Object.defineProperty(scratch, "getContext", { value: () => scratchContext });
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation(((tagName: string) =>
      tagName === "canvas" ? scratch : originalCreateElement(tagName)) as typeof document.createElement);
    const ctx = {
      canvas,
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      drawImage: vi.fn(), fillRect: vi.fn(), getImageData: vi.fn(() => { throw new Error("pixel read is not allowed"); }),
      filter: "none", globalAlpha: 1, fillStyle: "",
    };
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [{ ...solidMask(), style: "blur", width: 40, height: 30 }]);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(ctx.getImageData).not.toHaveBeenCalled();
    createElement.mockRestore();
  });

  it("mosaics pixels into equal colour blocks", () => {
    const ctx = new FakeContext();
    drawImageAnnotations(ctx as unknown as CanvasRenderingContext2D, [{ ...solidMask(), style: "mosaic", width: 4, height: 1 }]);
    expect(Array.from(ctx.pixels.slice(0, 4))).toEqual(Array.from(ctx.pixels.slice(4, 8)));
    expect(Array.from(ctx.pixels.slice(4, 8))).toEqual(Array.from(ctx.pixels.slice(8, 12)));
  });
});
