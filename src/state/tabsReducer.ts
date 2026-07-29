import { MarkdownLoadResult } from "../types/app";
import type { ImageSize } from "../hooks/useInlineImageResize";
import { localPathIdentity } from "../lib/pathIdentity";

export interface TabState {
  id: string;
  kind?: "document" | "settings";
  path: string;
  document: MarkdownLoadResult | null;
  error: string | null;
  loading: boolean;
  scrollTop: number;
  generation: number;
  externalChanged?: boolean;
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
  | { type: "IMAGE_DISPLAY_SIZE"; id: string; source: string; size: ImageSize }
  | { type: "MOVE"; id: string; toIndex: number };

export const initialTabsState: TabsState = { tabs: [], activeId: null, nextId: 1 };

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "OPEN": {
      return openTab(state, { path: action.path, scrollTop: 0, searchOpen: false, imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } });
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
      return updateTab(state, action.id, (tab) => ({ ...tab, loading: true, externalChanged: false, generation: tab.generation + 1 }));
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
          && localPathIdentity(tab.document?.path ?? tab.path) === localPathIdentity(action.document.path));
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
    case "IMAGE_DISPLAY_SIZE":
      return updateTab(state, action.id, (tab) => ({
        ...tab,
        imageDisplaySizes: { ...tab.imageDisplaySizes, [action.source]: action.size },
      }));
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
  return { ...state, tabs: state.tabs.map((tab) => tab.id === id ? update(tab) : tab) };
}

function openTab(state: TabsState, tab: ClosedTabState): TabsState {
  const identity = localPathIdentity(tab.path);
  const existing = state.tabs.find((candidate) =>
    candidate.kind !== "settings"
    && localPathIdentity(candidate.document?.path ?? candidate.path) === identity);
  if (existing) return { ...state, activeId: existing.id };
  const id = `tab-${state.nextId}`;
  return {
    tabs: [...state.tabs, { id, kind: "document", path: tab.path, document: null, error: null, loading: true, scrollTop: tab.scrollTop, generation: 1, externalChanged: false, searchOpen: tab.searchOpen ?? false, imageDisplaySizes: tab.imageDisplaySizes ?? {}, search: tab.search }],
    activeId: id,
    nextId: state.nextId + 1,
  };
}
