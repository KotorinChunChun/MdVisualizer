import { describe, expect, it } from "vitest";
import { resolvedResponsiveOverflowIds, responsiveItemAreaWidth, responsiveOverflowIds } from "./ResponsiveToolbar";

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
    expect(responsiveOverflowIds(0, items)).toEqual(["low", "medium", "high"]);
  });

  it("reserves the heading width before deciding which operations fit", () => {
    expect(responsiveItemAreaWidth(300, 72, true)).toBe(222);
    expect(responsiveItemAreaWidth(300, 72, false)).toBe(300);
    expect(responsiveItemAreaWidth(50, 72, true)).toBe(0);
  });

  it("switches every diagram action to the menu as one atomic group", () => {
    const items = [{ id: "edit" }, { id: "copy-view" }, { id: "storage" }];
    expect(resolvedResponsiveOverflowIds([], items, true)).toEqual([]);
    expect(resolvedResponsiveOverflowIds(["storage"], items, true)).toEqual(["edit", "copy-view", "storage"]);
    expect(resolvedResponsiveOverflowIds(["storage"], items, false)).toEqual(["storage"]);
  });
});
