import { MarkdownLoadResult } from "../types/app";

export interface TabState {
  id: string;
  path: string;
  document: MarkdownLoadResult | null;
  error: string | null;
  loading: boolean;
  scrollTop: number;
  generation: number;
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
  search: TabState["search"];
}

export type TabsAction =
  | { type: "OPEN"; path: string }
  | { type: "RESTORE"; tab: ClosedTabState }
  | { type: "ACTIVATE"; id: string }
  | { type: "RELOAD"; id: string }
  | { type: "CLOSE"; id: string }
  | { type: "LOADED"; id: string; generation: number; document: MarkdownLoadResult }
  | { type: "FAILED"; id: string; generation: number; error: string }
  | { type: "SCROLL"; id: string; scrollTop: number }
  | { type: "SEARCH"; id: string; search: TabState["search"] }
  | { type: "MOVE"; id: string; toIndex: number };

export const initialTabsState: TabsState = { tabs: [], activeId: null, nextId: 1 };

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "OPEN": {
      return openTab(state, { path: action.path, scrollTop: 0, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } });
    }
    case "RESTORE":
      return openTab(state, action.tab);
    case "ACTIVATE":
      return state.tabs.some((tab) => tab.id === action.id) ? { ...state, activeId: action.id } : state;
    case "RELOAD":
      return updateTab(state, action.id, (tab) => ({ ...tab, loading: true, generation: tab.generation + 1 }));
    case "CLOSE": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const activeId = state.activeId === action.id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : state.activeId;
      return { ...state, tabs, activeId };
    }
    case "LOADED":
      return updateTab(state, action.id, (tab) => tab.generation === action.generation ? { ...tab, document: action.document, loading: false, error: null } : tab);
    case "FAILED":
      return updateTab(state, action.id, (tab) => tab.generation === action.generation ? { ...tab, loading: false, error: action.error } : tab);
    case "SCROLL":
      return updateTab(state, action.id, (tab) => ({ ...tab, scrollTop: action.scrollTop }));
    case "SEARCH":
      return updateTab(state, action.id, (tab) => ({ ...tab, search: action.search }));
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
  const id = `tab-${state.nextId}`;
  return {
    tabs: [...state.tabs, { id, path: tab.path, document: null, error: null, loading: true, scrollTop: tab.scrollTop, generation: 1, search: tab.search }],
    activeId: id,
    nextId: state.nextId + 1,
  };
}
