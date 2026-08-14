import type { TabsState } from "../state/tabsReducer";

export interface DebugTabState {
  id: string;
  path: string;
  kind: string;
  active: boolean;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  editorMode: string;
}

export interface DebugWindowState {
  label: string;
  activeTabId: string | null;
  mediaPreviewOpen: boolean;
  tabs: DebugTabState[];
}

export function buildDebugWindowState(
  label: string,
  state: TabsState,
  mediaPreviewOpen: boolean,
): DebugWindowState {
  return {
    label,
    activeTabId: state.activeId,
    mediaPreviewOpen,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      path: tab.document?.path ?? tab.path,
      kind: tab.kind ?? "document",
      active: tab.id === state.activeId,
      dirty: tab.dirty,
      loading: tab.loading,
      error: tab.error,
      editorMode: tab.editorMode,
    })),
  };
}
