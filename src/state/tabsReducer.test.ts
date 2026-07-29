import { describe, expect, it } from "vitest";
import { initialTabsState, tabsReducer } from "./tabsReducer";

const loadedDocument = (path: string) => ({
  path,
  content: "# Test",
  base_dir: "C:/docs",
  image_paths: [],
  encoding: "UTF-8",
  size_bytes: 7,
  modified_at: "2026-07-29T00:00:00Z",
});

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

  it("tracks search visibility and pending changes per tab", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "OPEN", path: "a.md" });
    const second = state.activeId!;
    state = tabsReducer(state, { type: "SEARCH_VISIBILITY", id: first, open: true });
    state = tabsReducer(state, { type: "EXTERNAL_CHANGED", id: first, changed: true });

    expect(state.tabs.find((tab) => tab.id === first)).toMatchObject({ searchOpen: true, externalChanged: true });
    expect(state.tabs.find((tab) => tab.id === second)).toMatchObject({ searchOpen: false, externalChanged: false });
  });

  it("clears only the reloaded tab's pending change", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "OPEN", path: "a.md" });
    const second = state.activeId!;
    state = tabsReducer(state, { type: "EXTERNAL_CHANGED", id: first, changed: true });
    state = tabsReducer(state, { type: "EXTERNAL_CHANGED", id: second, changed: true });
    state = tabsReducer(state, { type: "RELOAD", id: first });

    expect(state.tabs.find((tab) => tab.id === first)?.externalChanged).toBe(false);
    expect(state.tabs.find((tab) => tab.id === second)?.externalChanged).toBe(true);
  });

  it("keeps inline image display sizes in each tab and restores them", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const id = state.activeId!;
    state = tabsReducer(state, { type: "IMAGE_DISPLAY_SIZE", id, source: "image.png", size: { width: 240, height: 120 } });
    expect(state.tabs[0].imageDisplaySizes["image.png"]).toEqual({ width: 240, height: 120 });

    const restored = tabsReducer(initialTabsState, {
      type: "RESTORE",
      tab: {
        path: "a.md",
        scrollTop: 0,
        imageDisplaySizes: state.tabs[0].imageDisplaySizes,
        search: state.tabs[0].search,
      },
    });
    expect(restored.tabs[0].imageDisplaySizes["image.png"]).toEqual({ width: 240, height: 120 });
  });

  it("adopts the canonical loaded path for watcher event matching", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: ".\\README.md" });
    const id = state.activeId!;
    const generation = state.tabs[0].generation;
    state = tabsReducer(state, {
      type: "LOADED",
      id,
      generation,
      document: loadedDocument("C:\\develop\\MarkdownViewer\\README.md"),
    });

    expect(state.tabs[0]).toMatchObject({
      path: "C:\\develop\\MarkdownViewer\\README.md",
      document: { path: "C:\\develop\\MarkdownViewer\\README.md" },
    });
  });
});
