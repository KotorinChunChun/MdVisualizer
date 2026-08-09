import { describe, expect, it } from "vitest";
import { resizeImageCanvasCentered, resizeImageCanvasFromEdge, type ImageCanvasGeometry } from "./imageCanvas";

const geometry: ImageCanvasGeometry = { width: 320, height: 240, imageX: 0, imageY: 0 };

describe("image canvas geometry", () => {
  it("adds numeric width and height symmetrically around existing content", () => {
    expect(resizeImageCanvasCentered(geometry, 420, 300)).toEqual({
      geometry: { width: 420, height: 300, imageX: 50, imageY: 30 },
      annotationShiftX: 50,
      annotationShiftY: 30,
    });
  });

  it("changes only the dragged side and shifts content for north or west", () => {
    expect(resizeImageCanvasFromEdge(geometry, "east", 100, 0)).toEqual({
      geometry: { width: 420, height: 240, imageX: 0, imageY: 0 },
      annotationShiftX: 0,
      annotationShiftY: 0,
    });
    expect(resizeImageCanvasFromEdge(geometry, "west", -100, 0)).toEqual({
      geometry: { width: 420, height: 240, imageX: 100, imageY: 0 },
      annotationShiftX: 100,
      annotationShiftY: 0,
    });
    expect(resizeImageCanvasFromEdge(geometry, "north", 0, 80)).toEqual({
      geometry: { width: 320, height: 160, imageX: 0, imageY: -80 },
      annotationShiftX: 0,
      annotationShiftY: -80,
    });
  });

  it("never produces a zero-sized canvas", () => {
    expect(resizeImageCanvasFromEdge(geometry, "east", -999, 0).geometry.width).toBe(1);
    expect(resizeImageCanvasCentered(geometry, Number.NaN, 0).geometry).toMatchObject({ width: 1, height: 1 });
  });
});
