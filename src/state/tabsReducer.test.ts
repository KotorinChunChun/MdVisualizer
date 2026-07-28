import { describe, expect, it } from "vitest";
import { initialTabsState, tabsReducer } from "./tabsReducer";

describe("tabsReducer", () => {
  it("keeps same-path tabs separate and activates the adjacent tab after close", () => {
    const opened = tabsReducer(tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" }), { type: "OPEN", path: "a.md" });
    expect(opened.tabs).toHaveLength(2);
    expect(opened.tabs[0].id).not.toBe(opened.tabs[1].id);
    const closed = tabsReducer(opened, { type: "CLOSE", id: "tab-2" });
    expect(closed.activeId).toBe("tab-1");
  });
});
