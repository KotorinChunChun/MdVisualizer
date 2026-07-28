import { describe, expect, it } from "vitest";
import { cropPixels } from "./cropGeometry";

describe("cropPixels", () => {
  it("maps percentage selection to source pixels independently of display zoom", () => {
    expect(cropPixels({ x: 10, y: 20, w: 50, h: 25 }, { w: 1200, h: 800 })).toEqual({ x: 120, y: 160, width: 600, height: 200 });
  });
});
