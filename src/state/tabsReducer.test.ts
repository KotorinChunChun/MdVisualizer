import { describe, expect, it } from "vitest";
import { initialTabsState, tabsReducer } from "./tabsReducer";

describe("tabsReducer", () => {
  it("keeps each tab scroll position independently", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "SCROLL", id: first, scrollTop: 480 });
    state = tabsReducer(state, { type: "OPEN", path: "b.md" });
    state = tabsReducer(state, { type: "ACTIVATE", id: first });
    expect(state.tabs.find((tab) => tab.id === first)?.scrollTop).toBe(480);
  });
});
