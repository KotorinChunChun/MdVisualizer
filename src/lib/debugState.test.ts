import { describe, expect, it } from "vitest";
import type { TabsState } from "../state/tabsReducer";
import { buildDebugWindowState } from "./debugState";

describe("debug window state", () => {
  it("reports canonical paths, active tabs, dirty state, and preview state without document contents", () => {
    const state: TabsState = {
      activeId: "tab-2",
      nextId: 3,
      tabs: [
        {
          id: "tab-1", kind: "document", path: "relative.md",
          document: { kind: "markdown", path: "C:\\docs\\relative.md", base_dir: "C:\\docs", content: "secret", image_paths: [], encoding: "utf-8", size_bytes: 6, modified_at: "2026-08-15T00:00:00Z", revision: "r1" },
          error: null, loading: false, scrollTop: 0, generation: 1, draft: "secret", dirty: true, saving: false, saveError: null,
          editorMode: "edit", pendingAssets: [], imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 },
        },
        {
          id: "tab-2", kind: "settings", path: "__settings__", document: null,
          error: null, loading: false, scrollTop: 0, generation: 1, draft: "", dirty: false, saving: false, saveError: null,
          editorMode: "preview", pendingAssets: [], imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 },
        },
      ],
    };

    const result = buildDebugWindowState("main", state, true);
    expect(result).toMatchObject({ label: "main", activeTabId: "tab-2", mediaPreviewOpen: true });
    expect(result.tabs[0]).toMatchObject({ path: "C:\\docs\\relative.md", dirty: true, active: false, editorMode: "edit" });
    expect(result.tabs[1]).toMatchObject({ path: "__settings__", kind: "settings", active: true });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
