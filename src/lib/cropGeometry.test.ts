import { describe, expect, it } from "vitest";
import { cropBoxFromDrag, cropBoxWithPadding, cropPixels, resizeCropBox } from "./cropGeometry";

describe("cropPixels", () => {
  it("maps percentage selection to source pixels independently of display zoom", () => {
    expect(cropPixels({ x: 10, y: 20, w: 50, h: 25 }, { w: 1200, h: 800 })).toEqual({ x: 120, y: 160, width: 600, height: 200 });
  });
});

describe("crop boundary geometry", () => {
  it("keeps the center fixed for Ctrl-modified edge and corner resizing", () => {
    expect(resizeCropBox({ x: 10, y: 20, w: 60, h: 40 }, "e", 10, 0, { w: 5, h: 5 }, true)).toEqual({ x: 0, y: 20, w: 80, h: 40 });
    expect(resizeCropBox({ x: 10, y: 20, w: 60, h: 40 }, "nw", 5, 5, { w: 5, h: 5 }, true)).toEqual({ x: 15, y: 25, w: 50, h: 30 });
  });

  it("converts independent side padding into an expanded crop box", () => {
    expect(cropBoxWithPadding({ w: 200, h: 100 }, { top: 10, right: 20, bottom: 30, left: 40 })).toEqual({ x: -20, y: -10, w: 130, h: 140 });
  });

  it("creates a center-fixed crop rectangle from a Ctrl-modified drag", () => {
    expect(cropBoxFromDrag({ x: 50, y: 40 }, { x: 70, y: 55 }, true)).toEqual({ x: 30, y: 25, w: 40, h: 30 });
  });
});
