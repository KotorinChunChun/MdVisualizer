import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TabBar } from "./components/TabBar";
import { ContextMenu } from "./components/ContextMenu";
import { StatusBar } from "./components/StatusBar";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { CropOverlay } from "./components/CropOverlay";
import { Toast } from "./components/Toast";
import { SearchBar } from "./components/SearchBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { ExternalActions } from "./components/ExternalActions";
import { PresentationView } from "./components/PresentationView";
import { useCropEditor } from "./hooks/useCropEditor";
import type { ImageSize } from "./hooks/useInlineImageResize";
import { useSearch } from "./hooks/useSearch";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { getInitialFiles, hasImageBackup, loadMarkdown, loadSettingsStatus, openContainingFolder, openExternalApp, openInEditor, openInNewWindow, removeWindowWatchTargets, restoreImage, saveFoldState, saveSettings, syncWatchTargets, updateExternalAppSettings } from "./lib/commands";
import { ToastState } from "./types/app";
import { ClosedTabState, initialTabsState, tabsReducer } from "./state/tabsReducer";
import { getMermaidStatus, subscribeMermaidStatus } from "./lib/mermaidStatus";
import { captureScrollAnchor, restoreScrollAnchor, type SemanticScrollAnchor } from "./lib/scrollAnchor";
import { DEFAULT_EXTERNAL_APPS, DEFAULT_PRESENTATION_LINE_THRESHOLD, normalizeExternalApps, normalizePresentationLineThreshold, type ExternalAppConfig } from "./types/settings";
import "./styles/app.css";
import "./styles/content.css";
import "./styles/crop.css";
import "./styles/themes.css";

// Keep this list in sync with StatusBar's fixed zoom choices.  Normalizing at
// the state boundary also repairs legacy persisted values that were not a
// selectable option.
export const ZOOM_LEVELS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200] as const;
export type ZoomLevel = typeof ZOOM_LEVELS[number];

export function normalizeZoom(value: number): ZoomLevel {
  return ZOOM_LEVELS.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest,
  ZOOM_LEVELS[0]);
}

export function moveZoomLevel(current: number, direction: 1 | -1): number {
  const index = ZOOM_LEVELS.indexOf(normalizeZoom(current));
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))];
}

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightLoads = useRef(new Set<string>());
  const reloadAnchors = useRef<Record<string, SemanticScrollAnchor>>({});
  const presentationPositions = useRef<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [theme, setTheme] = useState("system");
  const [zoom, setZoom] = useState(100);
  const [viewMode, setViewMode] = useState("standard");
  const [autoReload, setAutoReload] = useState<"on" | "off" | "manual">("on");
  const [foldStates, setFoldStates] = useState<Record<string, Record<string, boolean>>>({});
  const [mermaidMode, setMermaidMode] = useState<"on" | "off" | "error-code" | "always-code">("on");
  const [searchExpandedIds, setSearchExpandedIds] = useState<string[]>([]);
  const [mermaidStatus, setMermaidStatus] = useState(getMermaidStatus);
  const [imageBackups, setImageBackups] = useState<Record<string, boolean>>({});
  const [externalApps, setExternalApps] = useState<ExternalAppConfig[]>(DEFAULT_EXTERNAL_APPS);
  const [presentationLineThreshold, setPresentationLineThreshold] = useState(DEFAULT_PRESENTATION_LINE_THRESHOLD);
  const themeRef = useRef(theme);
  const zoomRef = useRef(zoom);
  const viewModeRef = useRef(viewMode);
  const autoReloadRef = useRef(autoReload);
  const mermaidModeRef = useRef(mermaidMode);
  const windowLabel = getCurrentWindow().label;

  const persistSetting = useCallback((key: "theme" | "zoom" | "viewMode" | "autoReload" | "mermaidMode", value: string | number) => {
    void saveSettings({ [key]: value }).catch((error) => {
      setToast({ id: String(Date.now()), message: `設定の保存に失敗しました: ${String(error)}`, type: "error" });
    });
  }, []);

  const updateTheme = useCallback((value: string) => {
    if (themeRef.current === value) return;
    themeRef.current = value;
    setTheme(value);
    persistSetting("theme", value);
  }, [persistSetting]);

  const updateZoom = useCallback((value: number | ((current: number) => number)) => {
    const requested = typeof value === "function" ? value(zoomRef.current) : value;
    const next = normalizeZoom(requested);
    if (zoomRef.current === next) return;
    zoomRef.current = next;
    setZoom(next);
    persistSetting("zoom", next);
  }, [persistSetting]);

  const updateViewMode = useCallback((value: string) => {
    if (viewModeRef.current === value) return;
    viewModeRef.current = value;
    setViewMode(value);
    persistSetting("viewMode", value);
  }, [persistSetting]);

  const updateAutoReload = useCallback((value: "on" | "off" | "manual") => {
    if (autoReloadRef.current === value) return;
    autoReloadRef.current = value;
    setAutoReload(value);
    persistSetting("autoReload", value);
  }, [persistSetting]);

  const updateMermaidMode = useCallback((value: "on" | "off" | "error-code" | "always-code") => {
    if (mermaidModeRef.current === value) return;
    mermaidModeRef.current = value;
    setMermaidMode(value);
    persistSetting("mermaidMode", value);
  }, [persistSetting]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    void loadSettingsStatus().then(({ settings, recoveredFiles }) => {
      if (typeof settings.theme === "string") { themeRef.current = settings.theme; setTheme(settings.theme); }
      if (typeof settings.zoom === "number") { const value = normalizeZoom(settings.zoom); zoomRef.current = value; setZoom(value); }
      if (typeof settings.viewMode === "string") { viewModeRef.current = settings.viewMode; setViewMode(settings.viewMode); }
      if (["on", "off", "manual"].includes(String(settings.autoReload))) { const value = settings.autoReload as "on" | "off" | "manual"; autoReloadRef.current = value; setAutoReload(value); }
      else if (typeof settings.autoReload === "boolean") { const value = settings.autoReload ? "on" : "off"; autoReloadRef.current = value; setAutoReload(value); }
      if (settings.foldStates && typeof settings.foldStates === "object") setFoldStates(settings.foldStates as Record<string, Record<string, boolean>>);
      if (["on", "off", "error-code", "always-code"].includes(String(settings.mermaidMode))) { const value = settings.mermaidMode as typeof mermaidMode; mermaidModeRef.current = value; setMermaidMode(value); }
      const apps = normalizeExternalApps(settings.externalApps);
      setExternalApps(apps);
      const lineThreshold = normalizePresentationLineThreshold(settings.presentationLineThreshold);
      setPresentationLineThreshold(lineThreshold);
      if (!Array.isArray(settings.externalApps)) {
        void saveSettings({ schemaVersion: 3, externalApps: apps, presentationLineThreshold: lineThreshold }).catch((error) => {
          setToast({ id: String(Date.now()), message: `外部アプリ設定の移行に失敗しました: ${String(error)}`, type: "error" });
        });
      }
      if (recoveredFiles.length > 0) {
        setToast({
          id: String(Date.now()),
          message: `破損した設定ファイルを退避し、初期設定で起動しました（${recoveredFiles.length}件）`,
          type: "info",
        });
      }
    }).catch((error) => setToast({ id: String(Date.now()), message: `設定の読込に失敗しました: ${String(error)}`, type: "error" }));
  }, []);

  useEffect(() => subscribeMermaidStatus(setMermaidStatus), []);

  useEffect(() => {
    const handleMarkdownToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; type?: ToastState["type"] }>).detail;
      if (!detail?.message) return;
      setToast({ id: String(Date.now()), message: detail.message, type: detail.type ?? "info" });
    };
    window.addEventListener("markdown-toast", handleMarkdownToast);
    return () => window.removeEventListener("markdown-toast", handleMarkdownToast);
  }, []);
  const [contextTab, setContextTab] = useState<{ id: string; x: number; y: number } | null>(null);
  const [closedTabs, setClosedTabs] = useState<ClosedTabState[]>([]);
  const [tabsState, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [imageVersions, setImageVersions] = useState<Record<string, number>>({});
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeId) ?? null;

  useEffect(() => {
    if (viewMode === "presentation" || !activeTab?.document) return;
    const headingId = presentationPositions.current[activeTab.id];
    if (!headingId) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const section = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-fold-id]") ?? [])]
          .find((candidate) => candidate.dataset.foldId === headingId);
        section?.scrollIntoView({ block: "start" });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [activeTab?.document, activeTab?.generation, activeTab?.id, viewMode]);
  const activeImageBackupAvailable = Boolean(activeTab?.document && activeTab.document.image_paths.some((path) => imageBackups[path]));
  const updateSearchExpandedIds = useCallback((ids: string[]) => {
    setSearchExpandedIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
  }, []);
  const searchRefreshKey = `${tabsState.activeId ?? "empty"}:${activeTab?.generation ?? 0}:${searchExpandedIds.join("|")}`;
  const search = useSearch(markdownRef, `${windowLabel}-${tabsState.activeId ?? "empty"}`, updateSearchExpandedIds, searchRefreshKey);
  const { cropTarget, startCrop, cancelCrop } = useCropEditor();
  const restoringSearchFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!activeTab) return;
    restoringSearchFor.current = activeTab.id;
    search.setQuery(activeTab.search.query);
    search.setRegex(activeTab.search.regex);
    search.setCaseSensitive(activeTab.search.caseSensitive);
    search.setActiveIndex(activeTab.search.activeIndex);
  }, [activeTab?.id]);

  useEffect(() => {
    if (activeTab?.searchOpen) window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [activeTab?.id, activeTab?.searchOpen]);

  useEffect(() => {
    if (!activeTab) return;
    if (restoringSearchFor.current === activeTab.id) {
      restoringSearchFor.current = null;
      return;
    }
    dispatch({ type: "SEARCH", id: activeTab.id, search: { query: search.query, regex: search.regex, caseSensitive: search.caseSensitive, activeIndex: search.activeIndex } });
  }, [activeTab?.id, search.query, search.regex, search.caseSensitive, search.activeIndex]);

  useEffect(() => {
    if (!containerRef.current || !activeTab || activeTab.loading) return;
    const tabId = activeTab.id;
    const reloadRestoreFrame = { current: 0 };
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        const anchor = reloadAnchors.current[tabId];
        if (anchor && markdownRef.current) {
          restoreScrollAnchor(container, markdownRef.current, anchor);
          delete reloadAnchors.current[tabId];
        } else {
          container.scrollTop = activeTab.scrollTop;
        }
      });
      reloadRestoreFrame.current = secondFrame;
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (reloadRestoreFrame.current) window.cancelAnimationFrame(reloadRestoreFrame.current);
    };
  }, [activeTab?.id, activeTab?.generation, activeTab?.loading]);

  useEffect(() => {
    const paths = activeTab?.document?.image_paths ?? [];
    if (paths.length === 0) return;
    let disposed = false;
    void Promise.all(paths.map(async (path) => [path, await hasImageBackup(path)] as const))
      .then((entries) => {
        if (!disposed) setImageBackups((current) => ({ ...current, ...Object.fromEntries(entries) }));
      })
      .catch(() => {
        // Backup status is supplemental; crop/restore errors are surfaced by
        // their own operations and should not interrupt document viewing.
      });
    return () => { disposed = true; };
  }, [activeTab?.id, activeTab?.document?.image_paths]);

  const loadTab = useCallback(async (id: string, path: string, generation: number) => {
    const loadKey = `${id}:${generation}`;
    if (inFlightLoads.current.has(loadKey)) return;
    inFlightLoads.current.add(loadKey);
    try {
      const document = await loadMarkdown(path);
      dispatch({ type: "LOADED", id, generation, document });
    } catch (error) {
      dispatch({ type: "FAILED", id, generation, error: String(error) });
    } finally {
      inFlightLoads.current.delete(loadKey);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const paths = await getInitialFiles();
      paths.forEach((path) => dispatch({ type: "OPEN", path }));
    })();
  }, []);

  useEffect(() => {
    for (const tab of tabsState.tabs) {
      if (tab.loading) void loadTab(tab.id, tab.path, tab.generation);
    }
  }, [tabsState.tabs, loadTab]);

  const watchTargetKey = JSON.stringify(
    [...new Set(tabsState.tabs.flatMap((tab) => tab.document ? [tab.document.path, ...tab.document.image_paths] : []))].sort(),
  );

  useEffect(() => {
    const targets: string[] = JSON.parse(watchTargetKey);
    if (autoReload !== "off" && targets.length > 0) void syncWatchTargets(windowLabel, targets);
    if (autoReload === "off") void removeWindowWatchTargets(windowLabel);
  }, [watchTargetKey, autoReload, windowLabel]);

  useEffect(() => () => { void removeWindowWatchTargets(windowLabel); }, [windowLabel]);

  useEffect(() => {
    if (!contextTab) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".context-menu")) setContextTab(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setContextTab(null); };
    document.addEventListener("pointerdown", dismissOnOutsidePointer, true);
    window.addEventListener("keydown", dismissOnEscape);
    return () => { document.removeEventListener("pointerdown", dismissOnOutsidePointer, true); window.removeEventListener("keydown", dismissOnEscape); };
  }, [contextTab]);

  const reloadTab = useCallback((id: string) => {
    if (id === activeTab?.id && containerRef.current && markdownRef.current) {
      const anchor = captureScrollAnchor(containerRef.current, markdownRef.current);
      if (anchor) reloadAnchors.current[id] = anchor;
    }
    dispatch({ type: "RELOAD", id });
  }, [activeTab?.id]);

  const reload = useCallback(() => {
    if (activeTab?.document) reloadTab(activeTab.id);
  }, [activeTab, reloadTab]);

  const applyFoldPreset = useCallback((preset: "expand" | "collapse" | "h1" | "h2" | "h3" | "current" | "reset") => {
    if (!activeTab?.document) return;
    if (preset === "reset") {
      const sections = [...(markdownRef.current?.querySelectorAll<HTMLElement>(".fold-section[data-fold-id]") ?? [])];
      const expanded = Object.fromEntries(sections.flatMap((section) => section.dataset.foldId ? [[section.dataset.foldId, false] as const] : []));
      setFoldStates((current) => {
        const next = { ...current, [activeTab.path]: expanded };
        void saveFoldState(activeTab.path, {}).catch((error) => setToast({ id: String(Date.now()), message: `折りたたみ状態の保存に失敗しました: ${String(error)}`, type: "error" }));
        return next;
      });
      return;
    }
    const sections = [...(markdownRef.current?.querySelectorAll<HTMLElement>(".fold-section[data-fold-id]") ?? [])];
    if (!sections.length) return;
    const headingLevel = (section: HTMLElement) => Number(section.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6")?.tagName.slice(1) ?? 6);
    const currentSection = preset === "current" ? sections.reduce<HTMLElement | null>((nearest, section) => {
      const top = section.getBoundingClientRect().top;
      return top <= (containerRef.current?.getBoundingClientRect().top ?? 0) && (!nearest || top > nearest.getBoundingClientRect().top) ? section : nearest;
    }, null) ?? sections[0] : null;
    setFoldStates((current) => {
      const next = { ...current[activeTab.path] };
      for (const section of sections) {
        const id = section.dataset.foldId;
        if (!id) continue;
        next[id] = preset === "collapse" ? true
          : preset === "expand" ? false
          : preset === "current" ? section !== currentSection
          : headingLevel(section) > Number(preset.slice(1));
      }
      void saveFoldState(activeTab.path, next).catch((error) => setToast({ id: String(Date.now()), message: `折りたたみ状態の保存に失敗しました: ${String(error)}`, type: "error" }));
      return { ...current, [activeTab.path]: next };
    });
  }, [activeTab]);

  const toggleFoldAll = useCallback(() => {
    if (!activeTab) return;
    const toggles = [...(markdownRef.current?.querySelectorAll<HTMLButtonElement>(".fold-toggle") ?? [])];
    const allCollapsed = toggles.length > 0 && toggles.every((toggle) => toggle.getAttribute("aria-expanded") === "false");
    applyFoldPreset(allCollapsed ? "expand" : "collapse");
  }, [activeTab, applyFoldPreset]);

  const handleFoldChange = useCallback((foldId: string, collapsed: boolean) => {
    const documentPath = activeTab?.path;
    if (!documentPath || !foldId) return;
    setFoldStates((current) => {
      const next = { ...current[documentPath], [foldId]: collapsed };
      void saveFoldState(documentPath, next).catch((error) => setToast({ id: String(Date.now()), message: `折りたたみ状態の保存に失敗しました: ${String(error)}`, type: "error" }));
      return { ...current, [documentPath]: next };
    });
  }, [activeTab?.path]);

  const handleSearchFoldManualOverride = useCallback((foldId: string) => {
    setSearchExpandedIds((ids) => ids.filter((id) => id !== foldId));
  }, []);

  const handlePreviewError = useCallback((message: string) => {
    setToast({ id: String(Date.now()), message, type: "error" });
  }, []);

  const handleOpenDocument = useCallback((path: string) => {
    dispatch({ type: "OPEN", path });
  }, []);

  const handleImageDisplaySizeChange = useCallback((source: string, size: ImageSize) => {
    if (activeTab) dispatch({ type: "IMAGE_DISPLAY_SIZE", id: activeTab.id, source, size });
  }, [activeTab?.id]);

  const executeExternalApp = useCallback((app: ExternalAppConfig) => {
    if (!activeTab?.document) return;
    const operation = app.builtinKind === "folder"
      ? openContainingFolder(activeTab.path)
      : app.builtinKind === "vscode" || app.builtinKind === "notepad"
        ? openInEditor(activeTab.path, app.builtinKind)
        : openExternalApp({
          executable: app.executable,
          args: app.args,
          workingDirectory: app.workingDirectory || undefined,
          file: activeTab.path,
          line: 1,
        });
    void operation.catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
  }, [activeTab?.document, activeTab?.path]);

  const openSettings = useCallback(() => dispatch({ type: "OPEN_SETTINGS" }), []);

  const saveExternalAppSettings = useCallback(async (apps: ExternalAppConfig[], lineThreshold: number) => {
    try {
      const previousById = new Map(externalApps.map((app) => [app.id, app]));
      const upserts = apps.filter((app) => JSON.stringify(previousById.get(app.id)) !== JSON.stringify(app));
      const nextIds = new Set(apps.map((app) => app.id));
      const removedIds = externalApps.filter((app) => !nextIds.has(app.id)).map((app) => app.id);
      const saved = await updateExternalAppSettings(upserts, removedIds, lineThreshold);
      setExternalApps(normalizeExternalApps(saved.externalApps));
      setPresentationLineThreshold(lineThreshold);
      setToast({ id: String(Date.now()), message: "設定を保存しました", type: "success" });
    } catch (error) {
      setToast({ id: String(Date.now()), message: `設定の保存に失敗しました: ${String(error)}`, type: "error" });
      throw error;
    }
  }, [externalApps]);

  const closeTab = useCallback((id: string) => {
    const tab = tabsState.tabs.find((candidate) => candidate.id === id);
    if (tab && tab.kind !== "settings") setClosedTabs((previous) => [{ path: tab.path, scrollTop: tab.scrollTop, searchOpen: tab.searchOpen, imageDisplaySizes: tab.imageDisplaySizes, search: tab.search }, ...previous].slice(0, 50));
    dispatch({ type: "CLOSE", id });
  }, [tabsState.tabs]);

  const closeActiveTab = useCallback(() => {
    if (!activeTab) return;
    if (tabsState.tabs.length === 1) void getCurrentWindow().close();
    else closeTab(activeTab.id);
  }, [activeTab, closeTab, tabsState.tabs.length]);

  const activateRelativeTab = useCallback((delta: number) => {
    const index = tabsState.tabs.findIndex((tab) => tab.id === tabsState.activeId);
    if (index < 0 || tabsState.tabs.length < 2) return;
    dispatch({ type: "ACTIVATE", id: tabsState.tabs[(index + delta + tabsState.tabs.length) % tabsState.tabs.length].id });
  }, [tabsState.activeId, tabsState.tabs]);

  const openSearch = useCallback(() => {
    if (activeTab?.document) dispatch({ type: "SEARCH_VISIBILITY", id: activeTab.id, open: true });
  }, [activeTab]);

  const closeSearch = useCallback(() => {
    if (!activeTab) return;
    search.clear();
    dispatch({ type: "SEARCH_VISIBILITY", id: activeTab.id, open: false });
  }, [activeTab, search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "t") {
        const [tab, ...remaining] = closedTabs;
        if (tab) { event.preventDefault(); setClosedTabs(remaining); dispatch({ type: "RESTORE", tab }); }
      }

      if (event.key === "F11") {
        event.preventDefault();
        void getCurrentWindow().isFullscreen().then((fullscreen) => getCurrentWindow().setFullscreen(!fullscreen));
        return;
      }

      if (event.key === "F5") {
        event.preventDefault();
        reload();
        return;
      }

      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        toggleFoldAll();
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key === "Escape" && activeTab?.searchOpen && !cropTarget) {
        event.preventDefault();
        closeSearch();
        return;
      }

      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        closeActiveTab();
      } else if (event.key === "Tab") {
        event.preventDefault();
        activateRelativeTab(event.shiftKey ? -1 : 1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        updateZoom((current) => moveZoomLevel(current, 1));
      } else if (event.key === "-") {
        event.preventDefault();
        updateZoom((current) => moveZoomLevel(current, -1));
      } else if (event.key === "0") {
        event.preventDefault();
        updateZoom(100);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab?.searchOpen, activateRelativeTab, closeActiveTab, closeSearch, closedTabs, cropTarget, openSearch, reload, search, toggleFoldAll, updateZoom]);

  const updateImageVersion = useCallback((imgPath: string) => {
    setImageVersions((previous) => ({ ...previous, [imgPath]: (previous[imgPath] || 0) + 1 }));
  }, []);

  const handleMarkdownChanged = useCallback(
    ({ path, changeKind }: { path: string; changeKind: string }) => {
      const tabs = tabsState.tabs.filter((candidate) => candidate.path === path);
      if (!tabs.length) return;
      const canReload = changeKind !== "deleted" && changeKind !== "renamed";
      if (autoReload === "on" && canReload) tabs.forEach((tab) => reloadTab(tab.id));
      else tabs.forEach((tab) => dispatch({ type: "EXTERNAL_CHANGED", id: tab.id, changed: true }));
    },
    [tabsState.tabs, autoReload, reloadTab]
  );

  const handleImageChanged = useCallback(
    ({ path, changeKind }: { path: string; changeKind: string }) => {
      if (changeKind !== "deleted" && changeKind !== "renamed") updateImageVersion(path);
    },
    [updateImageVersion]
  );

  useTauriEvents(handleMarkdownChanged, handleImageChanged);

  const handleCropApply = (filename: string, backupAvailable: boolean) => {
    cancelCrop();
    if (cropTarget) {
      updateImageVersion(cropTarget.fullPath);
      setImageBackups((current) => ({ ...current, [cropTarget.fullPath]: backupAvailable }));
      setToast({
        id: String(Date.now()),
        message: `${filename} を更新しました`,
        type: "success",
        restorePath: backupAvailable ? cropTarget.fullPath : undefined,
      });
    }
  };

  const handleRestore = async (path: string) => {
    try {
      const restored = await restoreImage(path);
      if (restored) {
        updateImageVersion(path);
        setImageBackups((current) => ({ ...current, [path]: false }));
        setToast({
          id: String(Date.now()),
          message: `元画像を復元しました`,
          type: "info",
        });
      }
    } catch (err) {
      console.error("Failed to restore image:", err);
      setToast({
        id: String(Date.now()),
        message: `復元に失敗しました: ${String(err)}`,
        type: "error",
      });
    }
  };

  const handleCropError = (message: string) => {
    setToast({
      id: String(Date.now()),
      message,
      type: "error",
    });
  };

  return (
    <div className="app-container">
      <TabBar tabs={tabsState.tabs} activeId={tabsState.activeId} onActivate={(id) => dispatch({ type: "ACTIVATE", id })} onClose={closeTab} onMove={(id, toIndex) => dispatch({ type: "MOVE", id, toIndex })} onContext={(id, x, y) => setContextTab({ id, x, y })} />
      {activeTab?.kind !== "settings" && <div className="view-controls" aria-label="表示と文書の操作">
        <div className="control-group document-actions">
          <button type="button" disabled={!activeTab?.document} onClick={openSearch}>検索</button>
          <button type="button" disabled={!activeTab?.document} onClick={reload}>再読み込み</button>
        </div>
        {viewMode !== "presentation" && <div className="control-group fold-controls">
          <span className="control-group__title">見出し</span>
          <select aria-label="見出しの表示" defaultValue="" onChange={(event) => {
            const value = event.target.value as "expand" | "collapse" | "h1" | "h2" | "h3" | "current" | "reset";
            if (value) applyFoldPreset(value);
            event.currentTarget.value = "";
          }}>
            <option value="" disabled>操作を選択</option><option value="expand">すべて展開</option><option value="collapse">すべて折りたたむ</option><option value="h1">H1のみ表示</option><option value="h2">H2まで表示</option><option value="h3">H3まで表示</option><option value="current">現在位置以外を折りたたむ</option><option value="reset">状態をリセット</option>
          </select>
        </div>}
        <ExternalActions apps={externalApps} disabled={!activeTab?.document} onExecute={executeExternalApp} />
        {autoReload === "manual" && activeTab?.externalChanged && <button type="button" className="pending-reload" onClick={reload}>変更あり: 再読み込み</button>}
        {activeTab?.searchOpen && <SearchBar search={search} inputRef={searchInputRef} onClose={closeSearch} />}
      </div>}

      <main className={`preview-container view-${viewMode}`} ref={containerRef} onScroll={(event) => { if (activeTab) dispatch({ type: "SCROLL", id: activeTab.id, scrollTop: event.currentTarget.scrollTop }); }} style={{ zoom: zoom / 100 }}>
        {activeTab?.kind === "settings" ? (
          <SettingsPanel apps={externalApps} presentationLineThreshold={presentationLineThreshold} onSave={saveExternalAppSettings} />
        ) : activeTab?.loading ? (
          <div className="empty-state">
            <div className="empty-icon">⏳</div>
            <div className="empty-title">読み込み中...</div>
          </div>
        ) : activeTab?.error && !activeTab.document ? (
          <div className="empty-state">
            <div className="empty-icon">⚠️</div>
            <div className="empty-title">ファイルを読み込めません</div>
            <div className="empty-desc">{activeTab.error}</div>
          </div>
        ) : activeTab?.document && viewMode === "presentation" ? (
          <PresentationView
            content={activeTab.document.content}
            baseDir={activeTab.document.base_dir}
            imageVersions={imageVersions}
            onStartCrop={startCrop}
            theme={theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
            onError={handlePreviewError}
            mermaidMode={mermaidMode}
            windowId={windowLabel}
            tabId={activeTab.id}
            imageDisplaySizes={activeTab.imageDisplaySizes}
            onOpenDocument={handleOpenDocument}
            lineThreshold={presentationLineThreshold}
            initialHeadingId={presentationPositions.current[activeTab.id]}
            onPageChange={(headingId) => { presentationPositions.current[activeTab.id] = headingId; }}
          />
        ) : activeTab?.document ? (
          <MarkdownPreview
            content={activeTab.document.content}
            baseDir={activeTab.document.base_dir}
            imageVersions={imageVersions}
            onStartCrop={startCrop}
            contentRef={markdownRef}
            theme={theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
            onError={handlePreviewError}
            foldState={foldStates[activeTab.path]}
            onFoldChange={handleFoldChange}
            mermaidMode={mermaidMode}
            windowId={windowLabel}
            tabId={activeTab.id}
            imageDisplaySizes={activeTab.imageDisplaySizes}
            onImageDisplaySizeChange={handleImageDisplaySizeChange}
            searchExpandedIds={searchExpandedIds}
            onSearchFoldManualOverride={handleSearchFoldManualOverride}
            onOpenDocument={handleOpenDocument}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📑</div>
            <div className="empty-title">Markdownファイルが指定されていません</div>
            <div className="empty-desc">
              <code>.md</code> ファイルをダブルクリックして開くか、コマンドライン引数で指定してください。
            </div>
          </div>
        )}
      </main>

      {cropTarget && (
        <CropOverlay
          target={cropTarget}
          onApply={handleCropApply}
          onCancel={cancelCrop}
          onError={handleCropError}
        />
      )}

      <Toast
        toast={toast}
        onRestore={handleRestore}
        onClose={() => setToast(null)}
      />
      <StatusBar
        document={activeTab?.document ?? null}
        autoReload={autoReload}
        onAutoReloadChange={updateAutoReload}
        zoom={zoom}
        onZoomChange={updateZoom}
        mermaidMode={mermaidMode}
        onMermaidModeChange={updateMermaidMode}
        mermaidStatus={mermaidStatus.pending ? `描画中 ${mermaidStatus.pending}` : mermaidStatus.error ? "エラー" : mermaidStatus.rendered ? `描画済み ${mermaidStatus.rendered}` : "対象なし"}
        mermaidErrorCount={mermaidStatus.errorCount}
        imageBackupAvailable={activeImageBackupAvailable}
        changed={activeTab?.externalChanged ?? false}
        theme={theme}
        onThemeChange={updateTheme}
        viewMode={viewMode}
        onViewModeChange={updateViewMode}
        onOpenSettings={openSettings}
        statusText={activeTab?.kind === "settings" ? "アプリケーション設定" : undefined}
      />
      {contextTab && (() => {
        const tab = tabsState.tabs.find((candidate) => candidate.id === contextTab.id);
        if (!tab) return null;
        const index = tabsState.tabs.indexOf(tab);
        const close = (id: string) => { closeTab(id); setContextTab(null); };
        return <ContextMenu tab={tab} x={contextTab.x} y={contextTab.y} onDismiss={() => setContextTab(null)} onClose={() => close(tab.id)} onCloseOthers={() => { tabsState.tabs.filter((candidate) => candidate.id !== tab.id).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onCloseRight={() => { tabsState.tabs.slice(index + 1).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onNewWindow={() => { void openInNewWindow(tab.path).catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" })); setContextTab(null); }} onError={(message) => setToast({ id: String(Date.now()), message, type: "error" })} />;
      })()}
    </div>
  );
}

export default App;
