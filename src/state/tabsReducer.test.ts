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

  it("keeps search options independently for each tab", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "SEARCH", id: first, search: { query: "alpha", regex: false, caseSensitive: true, activeIndex: 2 } });
    state = tabsReducer(state, { type: "OPEN", path: "b.md" });
    state = tabsReducer(state, { type: "ACTIVATE", id: first });
    expect(state.tabs.find((tab) => tab.id === first)?.search).toEqual({ query: "alpha", regex: false, caseSensitive: true, activeIndex: 2 });
  });

  it("restores scroll position and search state for a closed tab", () => {
    const state = tabsReducer(initialTabsState, { type: "RESTORE", tab: { path: "a.md", scrollTop: 480, search: { query: "alpha", regex: true, caseSensitive: false, activeIndex: 1 } } });
    expect(state.tabs[0]).toMatchObject({ path: "a.md", scrollTop: 480, search: { query: "alpha", regex: true, caseSensitive: false, activeIndex: 1 } });
  });
});
