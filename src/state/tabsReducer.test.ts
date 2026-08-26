import { describe, expect, it } from "vitest";
import { initialTabsState, tabsReducer } from "./tabsReducer";

const loadedDocument = (path: string) => ({
  path,
  kind: "markdown" as const,
  content: "# Test",
  base_dir: "C:/docs",
  image_paths: [],
  encoding: "UTF-8",
  size_bytes: 7,
  modified_at: "2026-07-29T00:00:00Z",
  revision: "revision-1",
});

describe("tabsReducer", () => {
  it("creates independent dirty untitled Markdown tabs in Edit mode", () => {
    let state = tabsReducer(initialTabsState, { type: "NEW_MARKDOWN" });
    state = tabsReducer(state, { type: "NEW_MARKDOWN" });

    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0]).toMatchObject({ path: "無題-1.md", untitled: true, dirty: true, loading: false, editorMode: "edit", draft: "" });
    expect(state.tabs[1]).toMatchObject({ path: "無題-2.md", untitled: true, dirty: true, loading: false, editorMode: "edit", draft: "" });
    expect(state.activeId).toBe(state.tabs[1].id);
  });

  it("keeps an untitled tab dirty until save succeeds and adopts the saved path", () => {
    let state = tabsReducer(initialTabsState, { type: "NEW_MARKDOWN" });
    const id = state.activeId!;
    state = tabsReducer(state, { type: "SAVE_STARTED", id });
    expect(state.tabs[0].saving).toBe(true);
    state = tabsReducer(state, { type: "SAVE_CANCELLED", id });
    expect(state.tabs[0]).toMatchObject({ untitled: true, dirty: true, saving: false });
    state = tabsReducer(state, { type: "SAVED", id, document: { ...loadedDocument("C:\\docs\\saved.md"), content: "" } });
    expect(state.tabs[0]).toMatchObject({ path: "C:\\docs\\saved.md", untitled: false, dirty: false, saving: false });
  });
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
    state = tabsReducer(state, { type: "OPEN", path: "b.md" });
    const second = state.activeId!;
    state = tabsReducer(state, { type: "SEARCH_VISIBILITY", id: first, open: true });
    state = tabsReducer(state, { type: "EXTERNAL_CHANGED", id: first, changed: true });

    expect(state.tabs.find((tab) => tab.id === first)).toMatchObject({ searchOpen: true, externalChanged: true });
    expect(state.tabs.find((tab) => tab.id === second)).toMatchObject({ searchOpen: false, externalChanged: false });
  });

  it("clears only the reloaded tab's pending change", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "OPEN", path: "b.md" });
    const second = state.activeId!;
    state = tabsReducer(state, { type: "EXTERNAL_CHANGED", id: first, changed: true });
    state = tabsReducer(state, { type: "EXTERNAL_CHANGED", id: second, changed: true });
    state = tabsReducer(state, { type: "SCROLL", id: first, scrollTop: 640 });
    state = tabsReducer(state, { type: "RELOAD", id: first });

    expect(state.tabs.find((tab) => tab.id === first)).toMatchObject({ externalChanged: false, scrollTop: 640, loading: true });
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

  it("ignores an image display size update when the measured size is unchanged", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const id = state.activeId!;
    state = tabsReducer(state, { type: "IMAGE_DISPLAY_SIZE", id, source: "image.png", size: { width: 240, height: 120 } });
    const measured = state;

    state = tabsReducer(state, { type: "IMAGE_DISPLAY_SIZE", id, source: "image.png", size: { width: 240, height: 120 } });

    expect(state).toBe(measured);
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

  it("activates an already open path instead of creating a duplicate tab", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "C:\\Docs\\Guide.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "OPEN", path: "c:/docs/./GUIDE.md" });

    expect(state.tabs).toHaveLength(1);
    expect(state.activeId).toBe(first);
  });

  it("collapses tabs that resolve to the same canonical loaded path", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: ".\\Guide.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "OPEN", path: "C:\\Docs\\Guide.md" });
    const second = state.activeId!;
    state = tabsReducer(state, {
      type: "LOADED",
      id: second,
      generation: 1,
      document: loadedDocument("C:\\Docs\\Guide.md"),
    });
    state = tabsReducer(state, {
      type: "LOADED",
      id: first,
      generation: 1,
      document: loadedDocument("C:\\Docs\\Guide.md"),
    });

    expect(state.tabs).toHaveLength(1);
    expect(state.activeId).toBe(second);
  });

  it("opens at most one settings tab and activates the existing one", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    state = tabsReducer(state, { type: "OPEN_SETTINGS" });
    const settingsId = state.activeId;
    state = tabsReducer(state, { type: "ACTIVATE", id: state.tabs[0].id });
    state = tabsReducer(state, { type: "OPEN_SETTINGS" });
    expect(state.tabs.filter((tab) => tab.kind === "settings")).toHaveLength(1);
    expect(state.activeId).toBe(settingsId);
  });

  it("tracks a Markdown draft independently from the saved document", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const id = state.activeId!;
    state = tabsReducer(state, { type: "LOADED", id, generation: 1, document: loadedDocument("C:\\docs\\a.md") });

    state = tabsReducer(state, { type: "DRAFT_CHANGED", id, content: "# Edited" });

    expect(state.tabs[0]).toMatchObject({ draft: "# Edited", dirty: true, saving: false });
    expect(state.tabs[0].document?.content).toBe("# Test");
  });

  it("keeps the first opened content after reloads and saves", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "C:\\docs\\a.md" });
    const id = state.tabs[0].id;
    state = tabsReducer(state, { type: "LOADED", id, generation: 1, document: { ...loadedDocument("C:\\docs\\a.md"), content: "opened" } });
    state = tabsReducer(state, { type: "SAVED", id, document: { ...loadedDocument("C:\\docs\\a.md"), content: "saved" } });
    state = tabsReducer(state, { type: "RELOAD", id });
    state = tabsReducer(state, { type: "LOADED", id, generation: 2, document: { ...loadedDocument("C:\\docs\\a.md"), content: "external" } });
    expect(state.tabs[0].openedContent).toBe("opened");
  });

  it("keeps the editor workspace mode independently in each tab", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const first = state.activeId!;
    state = tabsReducer(state, { type: "EDITOR_MODE", id: first, mode: "split" });
    state = tabsReducer(state, { type: "OPEN", path: "b.md" });

    expect(state.tabs.find((tab) => tab.id === first)?.editorMode).toBe("split");
    expect(state.tabs.find((tab) => tab.id === state.activeId)?.editorMode).toBe("preview");
  });

  it("keeps edits made while an earlier draft is being saved", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const id = state.activeId!;
    state = tabsReducer(state, { type: "LOADED", id, generation: 1, document: loadedDocument("C:\\docs\\a.md") });
    state = tabsReducer(state, { type: "DRAFT_CHANGED", id, content: "# First edit" });
    state = tabsReducer(state, { type: "SAVE_STARTED", id });
    state = tabsReducer(state, { type: "DRAFT_CHANGED", id, content: "# Second edit" });

    state = tabsReducer(state, {
      type: "SAVED",
      id,
      document: { ...loadedDocument("C:\\docs\\a.md"), content: "# First edit", revision: "revision-2" },
    });

    expect(state.tabs[0]).toMatchObject({ draft: "# Second edit", dirty: true, saving: false });
    expect(state.tabs[0].document).toMatchObject({ content: "# First edit", revision: "revision-2" });
  });

  it("retains a dirty draft when saving fails", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "a.md" });
    const id = state.activeId!;
    state = tabsReducer(state, { type: "LOADED", id, generation: 1, document: loadedDocument("C:\\docs\\a.md") });
    state = tabsReducer(state, { type: "DRAFT_CHANGED", id, content: "# Edited" });
    state = tabsReducer(state, { type: "SAVE_STARTED", id });
    state = tabsReducer(state, { type: "SAVE_FAILED", id, error: "Conflict" });

    expect(state.tabs[0]).toMatchObject({ draft: "# Edited", dirty: true, saving: false, saveError: "Conflict" });
  });

  it("keeps staged assets through edits and removes only those committed by a save", () => {
    let state = tabsReducer(initialTabsState, { type: "OPEN", path: "C:/docs/a.md" });
    state = tabsReducer(state, { type: "LOADED", id: "tab-1", generation: 1, document: { ...loadedDocument("C:/docs/a.md"), content: "old" } });
    state = tabsReducer(state, { type: "STAGED_ASSET_ADDED", id: "tab-1", content: "![x](image.png)", asset: { id: "stage-1", filename: "image.png" } });
    state = tabsReducer(state, { type: "DRAFT_CHANGED", id: "tab-1", content: "# title\n![x](image.png)" });
    expect(state.tabs[0].pendingAssets?.map((asset) => asset.id)).toEqual(["stage-1"]);
    state = tabsReducer(state, { type: "STAGED_ASSET_UPDATED", id: "tab-1", stagingId: "stage-1", text: "updated" });
    expect(state.tabs[0].pendingAssets?.[0]?.text).toBe("updated");
    state = tabsReducer(state, { type: "SAVED", id: "tab-1", document: { ...loadedDocument("C:/docs/a.md"), content: "![x](image.png)", revision: "revision-2" }, committedAssetIds: ["stage-1"] });
    expect(state.tabs[0].pendingAssets).toEqual([]);
    expect(state.tabs[0].dirty).toBe(true);
  });
});
