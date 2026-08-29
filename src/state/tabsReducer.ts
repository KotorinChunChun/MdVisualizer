import { MarkdownLoadResult } from "../types/app";
import type { StagedDocumentAsset } from "../types/app";
import type { ImageSize } from "../hooks/useInlineImageResize";
import { documentSourceIdentity } from "../lib/pathIdentity";

export type EditorWorkspaceMode = "edit" | "split" | "preview";

export interface TabState {
  id: string;
  kind?: "document" | "settings";
  path: string;
  /** True until a Ctrl+N document is assigned a filesystem path. */
  untitled?: boolean;
  document: MarkdownLoadResult | null;
  /** The last content successfully persisted by the app; the Diff comparison baseline. */
  openedContent?: string;
  error: string | null;
  loading: boolean;
  scrollTop: number;
  generation: number;
  externalChanged?: boolean;
  draft: string;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  editorMode: EditorWorkspaceMode;
  pendingAssets?: StagedDocumentAsset[];
  searchOpen?: boolean;
  imageDisplaySizes: Record<string, ImageSize>;
  search: { query: string; regex: boolean; caseSensitive: boolean; activeIndex: number };
}

export interface TabsState {
  tabs: TabState[];
  activeId: string | null;
  nextId: number;
}

export interface ClosedTabState {
  path: string;
  scrollTop: number;
  searchOpen?: boolean;
  imageDisplaySizes?: Record<string, ImageSize>;
  search: TabState["search"];
}

export type TabsAction =
  | { type: "OPEN"; path: string }
  | { type: "NEW_MARKDOWN" }
  | { type: "OPEN_SETTINGS" }
  | { type: "RESTORE"; tab: ClosedTabState }
  | { type: "ACTIVATE"; id: string }
  | { type: "RELOAD"; id: string }
  | { type: "CLOSE"; id: string }
  | { type: "LOADED"; id: string; generation: number; document: MarkdownLoadResult }
  | { type: "FAILED"; id: string; generation: number; error: string }
  | { type: "SCROLL"; id: string; scrollTop: number }
  | { type: "SEARCH"; id: string; search: TabState["search"] }
  | { type: "SEARCH_VISIBILITY"; id: string; open: boolean }
  | { type: "EXTERNAL_CHANGED"; id: string; changed: boolean }
  | { type: "DRAFT_CHANGED"; id: string; content: string }
  | { type: "SAVE_STARTED"; id: string; force?: boolean }
  | { type: "SAVED"; id: string; document: MarkdownLoadResult; committedAssetIds?: string[] }
  | { type: "IMMEDIATE_SAVED"; id: string; document: MarkdownLoadResult; draft: string; openedContent: string; committedAssetIds?: string[] }
  | { type: "SAVE_FAILED"; id: string; error: string }
  | { type: "SAVE_CANCELLED"; id: string }
  | { type: "EDITOR_MODE"; id: string; mode: EditorWorkspaceMode }
  | { type: "STAGED_ASSET_ADDED"; id: string; content: string; asset: StagedDocumentAsset }
  | { type: "STAGED_ASSET_REMOVED"; id: string; content: string; stagingId: string }
  | { type: "STAGED_ASSET_UPDATED"; id: string; stagingId: string; text: string }
  | { type: "IMAGE_DISPLAY_SIZE"; id: string; source: string; size: ImageSize }
  | { type: "MOVE"; id: string; toIndex: number };

export const initialTabsState: TabsState = { tabs: [], activeId: null, nextId: 1 };

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "OPEN": {
      return openTab(state, { path: action.path, scrollTop: 0, searchOpen: false, imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } });
    }
    case "NEW_MARKDOWN": {
      const id = `tab-${state.nextId}`;
      const path = `無題-${state.nextId}.md`;
      const document: MarkdownLoadResult = {
        path,
        kind: "markdown",
        content: "",
        base_dir: "",
        image_paths: [],
        encoding: "UTF-8",
        size_bytes: 0,
        modified_at: "",
        revision: "",
        source: "local",
        web_url: null,
        etag: null,
      };
      return {
        tabs: [...state.tabs, {
          id,
          kind: "document",
          path,
          untitled: true,
          document,
          openedContent: "",
          error: null,
          loading: false,
          scrollTop: 0,
          generation: 1,
          externalChanged: false,
          draft: "",
          dirty: true,
          saving: false,
          saveError: null,
          editorMode: "edit",
          pendingAssets: [],
          searchOpen: false,
          imageDisplaySizes: {},
          search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 },
        }],
        activeId: id,
        nextId: state.nextId + 1,
      };
    }
    case "OPEN_SETTINGS": {
      const existing = state.tabs.find((tab) => tab.kind === "settings");
      if (existing) return { ...state, activeId: existing.id };
      const id = `tab-${state.nextId}`;
      return {
        tabs: [...state.tabs, {
          id,
          kind: "settings",
          path: "__settings__",
          document: null,
          error: null,
          loading: false,
          scrollTop: 0,
          generation: 1,
          externalChanged: false,
          draft: "",
          dirty: false,
          saving: false,
          saveError: null,
          editorMode: "preview",
          pendingAssets: [],
          searchOpen: false,
          imageDisplaySizes: {},
          search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 },
        }],
        activeId: id,
        nextId: state.nextId + 1,
      };
    }
    case "RESTORE":
      return openTab(state, action.tab);
    case "ACTIVATE":
      return state.tabs.some((tab) => tab.id === action.id) ? { ...state, activeId: action.id } : state;
    case "RELOAD":
      return updateTab(state, action.id, (tab) => tab.untitled ? tab : ({ ...tab, loading: true, externalChanged: false, generation: tab.generation + 1 }));
    case "CLOSE": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const activeId = state.activeId === action.id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : state.activeId;
      return { ...state, tabs, activeId };
    }
    case "LOADED":
      // `load_markdown` returns the canonical absolute path.  Keep it on the
      // tab as well so file-watcher events use the same representation even
      // when the application was launched with a relative path.
      {
        const current = state.tabs.find((tab) => tab.id === action.id);
        if (!current || current.generation !== action.generation) return state;
        const duplicate = state.tabs.find((tab) =>
          tab.id !== action.id
          && tab.kind !== "settings"
          && documentSourceIdentity(tab.document?.path ?? tab.path) === documentSourceIdentity(action.document.path));
        if (duplicate) {
          return {
            ...state,
            tabs: state.tabs.filter((tab) => tab.id !== action.id),
            activeId: state.activeId === action.id ? duplicate.id : state.activeId,
          };
        }
        return updateTab(state, action.id, (tab) => ({
        ...tab,
        path: action.document.path,
        document: action.document,
        openedContent: tab.openedContent ?? action.document.content,
        draft: action.document.content,
        dirty: false,
        saving: false,
        saveError: null,
        pendingAssets: [],
        externalChanged: false,
        loading: false,
        error: null,
        }));
      }
    case "FAILED":
      return updateTab(state, action.id, (tab) => tab.generation === action.generation ? { ...tab, loading: false, error: action.error } : tab);
    case "SCROLL":
      return updateTab(state, action.id, (tab) => ({ ...tab, scrollTop: action.scrollTop }));
    case "SEARCH":
      return updateTab(state, action.id, (tab) => ({ ...tab, search: action.search }));
    case "SEARCH_VISIBILITY":
      return updateTab(state, action.id, (tab) => ({ ...tab, searchOpen: action.open }));
    case "EXTERNAL_CHANGED":
      return updateTab(state, action.id, (tab) => ({ ...tab, externalChanged: action.changed }));
    case "DRAFT_CHANGED":
      return updateTab(state, action.id, (tab) => {
        if (!tab.document || tab.draft === action.content) return tab;
        return {
          ...tab,
          draft: action.content,
          dirty: action.content !== tab.document.content,
          saveError: null,
        };
      });
    case "SAVE_STARTED":
      return updateTab(state, action.id, (tab) => tab.document && (tab.dirty || action.force)
        ? { ...tab, saving: true, saveError: null }
        : tab);
    case "SAVED":
      return updateTab(state, action.id, (tab) => {
        const draft = tab.draft === action.document.content ? action.document.content : tab.draft;
        return {
          ...tab,
          path: action.document.path,
          untitled: false,
          document: action.document,
          openedContent: action.document.content,
          draft,
          dirty: draft !== action.document.content,
          saving: false,
          saveError: null,
          externalChanged: false,
          pendingAssets: (tab.pendingAssets ?? []).filter((asset) => !(action.committedAssetIds ?? []).includes(asset.id)),
        };
      });
    case "IMMEDIATE_SAVED":
      return updateTab(state, action.id, (tab) => ({
        ...tab,
        path: action.document.path,
        untitled: false,
        document: action.document,
        openedContent: action.openedContent,
        draft: action.draft,
        dirty: action.draft !== action.document.content,
        saving: false,
        saveError: null,
        externalChanged: false,
        pendingAssets: (tab.pendingAssets ?? []).filter((asset) => !(action.committedAssetIds ?? []).includes(asset.id)),
      }));
    case "SAVE_FAILED":
      return updateTab(state, action.id, (tab) => ({ ...tab, saving: false, saveError: action.error }));
    case "SAVE_CANCELLED":
      return updateTab(state, action.id, (tab) => ({ ...tab, saving: false, saveError: null }));
    case "EDITOR_MODE":
      return updateTab(state, action.id, (tab) => tab.editorMode === action.mode ? tab : { ...tab, editorMode: action.mode });
    case "STAGED_ASSET_ADDED":
      return updateTab(state, action.id, (tab) => !tab.document ? tab : ({ ...tab, draft: action.content, dirty: action.content !== tab.document.content, pendingAssets: [...(tab.pendingAssets ?? []), action.asset], saveError: null }));
    case "STAGED_ASSET_REMOVED":
      return updateTab(state, action.id, (tab) => !tab.document ? tab : ({ ...tab, draft: action.content, dirty: action.content !== tab.document.content, pendingAssets: (tab.pendingAssets ?? []).filter((asset) => asset.id !== action.stagingId), saveError: null }));
    case "STAGED_ASSET_UPDATED":
      return updateTab(state, action.id, (tab) => !tab.document ? tab : ({
        ...tab,
        pendingAssets: (tab.pendingAssets ?? []).map((asset) => asset.id === action.stagingId ? { ...asset, text: action.text } : asset),
        saveError: null,
      }));
    case "IMAGE_DISPLAY_SIZE":
      return updateTab(state, action.id, (tab) => {
        const current = tab.imageDisplaySizes[action.source];
        if (current?.width === action.size.width && current.height === action.size.height) return tab;
        return {
          ...tab,
          imageDisplaySizes: { ...tab.imageDisplaySizes, [action.source]: action.size },
        };
      });
    case "MOVE": {
      const from = state.tabs.findIndex((tab) => tab.id === action.id);
      if (from < 0 || action.toIndex < 0 || action.toIndex >= state.tabs.length || from === action.toIndex) return state;
      const tabs = [...state.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(action.toIndex, 0, tab);
      return { ...state, tabs };
    }
  }
}

function updateTab(state: TabsState, id: string, update: (tab: TabState) => TabState): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const nextTab = update(state.tabs[index]);
  if (nextTab === state.tabs[index]) return state;
  const tabs = [...state.tabs];
  tabs[index] = nextTab;
  return { ...state, tabs };
}

function openTab(state: TabsState, tab: ClosedTabState): TabsState {
  const identity = documentSourceIdentity(tab.path);
  const existing = state.tabs.find((candidate) =>
    candidate.kind !== "settings"
    && documentSourceIdentity(candidate.document?.path ?? candidate.path) === identity);
  if (existing) return { ...state, activeId: existing.id };
  const id = `tab-${state.nextId}`;
  return {
    tabs: [...state.tabs, { id, kind: "document", path: tab.path, document: null, error: null, loading: true, scrollTop: tab.scrollTop, generation: 1, externalChanged: false, draft: "", dirty: false, saving: false, saveError: null, editorMode: "preview", pendingAssets: [], searchOpen: tab.searchOpen ?? false, imageDisplaySizes: tab.imageDisplaySizes ?? {}, search: tab.search }],
    activeId: id,
    nextId: state.nextId + 1,
  };
}
