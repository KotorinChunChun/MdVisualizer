import { describe, expect, it } from "vitest";
import { responsiveOverflowIds } from "./ResponsiveToolbar";

describe("responsive toolbar", () => {
  it("moves low-priority non-fixed items to overflow until one line fits", () => {
    const items = [
      { id: "fixed", width: 100, priority: 0, fixed: true },
      { id: "high", width: 80, priority: 100 },
      { id: "medium", width: 70, priority: 50 },
      { id: "low", width: 60, priority: 10 },
    ];

    expect(responsiveOverflowIds(330, items)).toEqual([]);
    expect(responsiveOverflowIds(250, items)).toEqual(["low", "medium"]);
    expect(responsiveOverflowIds(170, items)).toEqual(["low", "medium", "high"]);
    expect(responsiveOverflowIds(0, items)).toEqual([]);
  });
});
