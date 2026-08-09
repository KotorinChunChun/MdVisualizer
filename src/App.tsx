import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TabBar } from "./components/TabBar";
import { ContextMenu } from "./components/ContextMenu";
import { StatusBar } from "./components/StatusBar";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { CropOverlay } from "./components/CropOverlay";
import { Toast } from "./components/Toast";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { SettingsPanel } from "./components/SettingsPanel";
import { ExternalActions } from "./components/ExternalActions";
import { PresentationView } from "./components/PresentationView";
import { MediaPreviewModal, type ImageEditContext, type MediaPreviewTarget } from "./components/MediaPreviewModal";
import { ImageGallery, type ImageGalleryItem } from "./components/ImageGallery";
import { ImageAnnotationEditor } from "./components/ImageAnnotationEditor";
import { ShortcutHelpModal } from "./components/ShortcutHelpModal";
import { DocumentToc } from "./components/DocumentToc";
import { DocumentSidePanel, type DocumentSidePanelTab } from "./components/DocumentSidePanel";
import { DiagnosticsPanel, type DiagnosticItem } from "./components/DiagnosticsPanel";
import { useCropEditor } from "./hooks/useCropEditor";
import type { ImageSize } from "./hooks/useInlineImageResize";
import { useSearch } from "./hooks/useSearch";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useFileDrop } from "./hooks/useFileDrop";
import { diagnoseDocument, getInitialFiles, hasImageBackup, loadMarkdown, loadSettingsStatus, openContainingFolder, openExternalApp, openInEditor, openInNewWindow, removeWindowWatchTargets, renameImageAndReferences, restoreImage, saveFoldState, saveSettings, syncWatchTargets, updateExternalAppSettings, updateImageCaption } from "./lib/commands";
import { ToastState } from "./types/app";
import { ClosedTabState, initialTabsState, tabsReducer } from "./state/tabsReducer";
import { getMermaidStatus, subscribeMermaidStatus } from "./lib/mermaidStatus";
import { captureScrollAnchor, restoreScrollAnchor, type SemanticScrollAnchor } from "./lib/scrollAnchor";
import { ancestorFoldIds, toggleNestedFoldStates } from "./lib/foldSections";
import { DEFAULT_EXTERNAL_APPS, DEFAULT_IMAGE_A4_TARGET_WIDTH, DEFAULT_IMAGE_EQUAL_PADDING, DEFAULT_PRESENTATION_LINE_THRESHOLD, normalizeExternalApps, normalizeImageA4TargetWidth, normalizeImageEqualPadding, normalizePresentationLineThreshold, type ExternalAppConfig } from "./types/settings";
import { emptyNavigationHistory, navigateBack, navigateForward, recordNavigation, type NavigationSnapshot } from "./lib/navigationHistory";
import { localPathIdentity } from "./lib/pathIdentity";
import { collectImageOccurrences, groupImageOccurrences } from "./lib/imageOccurrences";
import { resolveImageSrc } from "./lib/path";
import { acceptAuxiliaryNavigation, isShortcutHelpShortcut, isZoomInShortcut, type AuxiliaryNavigationStamp } from "./lib/shortcuts";
import { normalizeDocumentViewModes, type ViewMode } from "./lib/viewMode";
import { listenForSecondaryLaunches } from "./lib/secondaryLaunchEvents";
import { applySyntaxHighlightSettings, DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS, normalizeSyntaxHighlightSettings, type SyntaxHighlightSettings } from "./lib/syntaxHighlight";
import { applyPrintStyleSettings, DEFAULT_PRINT_STYLE_SETTINGS, normalizePrintStyleSettings, type PrintStyleSettings } from "./lib/printStyle";
import "./styles/app.css";
import "./styles/content.css";
import "./styles/crop.css";
import "./styles/themes.css";
import "./styles/syntax-highlight.css";

// Keep this list in sync with StatusBar's fixed zoom choices.  Normalizing at
// the state boundary also repairs legacy persisted values that were not a
// selectable option.
export const ZOOM_LEVELS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200] as const;
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

export function focusAndSelectSearchInput(input: HTMLInputElement | null): void {
  input?.focus();
  input?.select();
}

export function resolveDocumentSidePanel(searchOpen: boolean, requestedPanel: Exclude<DocumentSidePanelTab, "search"> | null): DocumentSidePanelTab | null {
  if (searchOpen) return "search";
  return requestedPanel;
}

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightLoads = useRef(new Set<string>());
  const reloadAnchors = useRef<Record<string, SemanticScrollAnchor>>({});
  const [presentationPositions, setPresentationPositions] = useState<Record<string, string>>({});
  const presentationPositionsRef = useRef<Record<string, string>>({});
  const presentationSourceLines = useRef<Record<string, number>>({});
  const wasPresentationMode = useRef(false);
  const presentationRestorePending = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [theme, setTheme] = useState("system");
  const [zoom, setZoom] = useState(100);
  const [viewMode, setViewMode] = useState<ViewMode>("auto");
  const [documentViewModes, setDocumentViewModes] = useState<Record<string, ViewMode>>({});
  const [autoReload, setAutoReload] = useState<"on" | "off" | "manual">("on");
  const [foldStates, setFoldStates] = useState<Record<string, Record<string, boolean>>>({});
  const [mermaidMode, setMermaidMode] = useState<"on" | "off" | "error-code" | "always-code">("on");
  const [searchExpandedIds, setSearchExpandedIds] = useState<string[]>([]);
  const [codeHighlightRevision, setCodeHighlightRevision] = useState(0);
  const [mermaidStatus, setMermaidStatus] = useState(getMermaidStatus);
  const [imageBackups, setImageBackups] = useState<Record<string, boolean>>({});
  const [externalApps, setExternalApps] = useState<ExternalAppConfig[]>(DEFAULT_EXTERNAL_APPS);
  const [presentationLineThreshold, setPresentationLineThreshold] = useState(DEFAULT_PRESENTATION_LINE_THRESHOLD);
  const [imageA4TargetWidth, setImageA4TargetWidth] = useState(DEFAULT_IMAGE_A4_TARGET_WIDTH);
  const [imageEqualPadding, setImageEqualPadding] = useState(DEFAULT_IMAGE_EQUAL_PADDING);
  const [syntaxHighlight, setSyntaxHighlight] = useState<SyntaxHighlightSettings>(DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS);
  const [printStyle, setPrintStyle] = useState<PrintStyleSettings>(DEFAULT_PRINT_STYLE_SETTINGS);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewTarget | null>(null);
  const [annotationTarget, setAnnotationTarget] = useState<import("./hooks/useCropEditor").CropTarget | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [documentPanels, setDocumentPanels] = useState<Record<string, Exclude<DocumentSidePanelTab, "search"> | null>>({});
  const documentPanelsRef = useRef(documentPanels);
  const panelBeforeSearchRef = useRef<Record<string, Exclude<DocumentSidePanelTab, "search"> | null>>({});
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [printing, setPrinting] = useState(false);
  const [activeTocHeadingId, setActiveTocHeadingId] = useState<string | null>(null);
  const [activeImageOccurrenceId, setActiveImageOccurrenceId] = useState<string | null>(null);
  const tocPointerFrame = useRef(0);
  const pendingTocHeadingId = useRef<string | null>(null);
  const mediaPreviewRef = useRef<MediaPreviewTarget | null>(null);
  const navigationHistoryRef = useRef(emptyNavigationHistory());
  const auxiliaryNavigationRef = useRef<AuxiliaryNavigationStamp>({ button: -1, timestamp: 0 });
  const themeRef = useRef(theme);
  const zoomRef = useRef(zoom);
  const viewModeRef = useRef(viewMode);
  const documentViewModesRef = useRef(documentViewModes);
  const autoReloadRef = useRef(autoReload);
  const mermaidModeRef = useRef(mermaidMode);
  const windowLabel = getCurrentWindow().label;
  documentPanelsRef.current = documentPanels;
  documentViewModesRef.current = documentViewModes;

  const persistSetting = useCallback((key: "theme" | "zoom" | "autoReload" | "mermaidMode", value: string | number) => {
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
    applySyntaxHighlightSettings(document.documentElement, syntaxHighlight);
  }, [syntaxHighlight]);

  useEffect(() => {
    applyPrintStyleSettings(document.documentElement, printStyle);
  }, [printStyle]);

  useEffect(() => {
    void loadSettingsStatus().then(({ settings, recoveredFiles }) => {
      if (typeof settings.theme === "string") { themeRef.current = settings.theme; setTheme(settings.theme); }
      if (typeof settings.zoom === "number") { const value = normalizeZoom(settings.zoom); zoomRef.current = value; setZoom(value); }
      const normalizedDocumentViewModes = normalizeDocumentViewModes(settings.documentViewModes);
      setDocumentViewModes(normalizedDocumentViewModes);
      if (["on", "off", "manual"].includes(String(settings.autoReload))) { const value = settings.autoReload as "on" | "off" | "manual"; autoReloadRef.current = value; setAutoReload(value); }
      else if (typeof settings.autoReload === "boolean") { const value = settings.autoReload ? "on" : "off"; autoReloadRef.current = value; setAutoReload(value); }
      if (settings.foldStates && typeof settings.foldStates === "object") setFoldStates(settings.foldStates as Record<string, Record<string, boolean>>);
      if (["on", "off", "error-code", "always-code"].includes(String(settings.mermaidMode))) { const value = settings.mermaidMode as typeof mermaidMode; mermaidModeRef.current = value; setMermaidMode(value); }
      const apps = normalizeExternalApps(settings.externalApps);
      setExternalApps(apps);
      const lineThreshold = normalizePresentationLineThreshold(settings.presentationLineThreshold);
      setPresentationLineThreshold(lineThreshold);
      const a4TargetWidth = normalizeImageA4TargetWidth(settings.imageA4TargetWidth);
      const equalPadding = normalizeImageEqualPadding(settings.imageEqualPadding);
      const normalizedSyntaxHighlight = normalizeSyntaxHighlightSettings(settings.syntaxHighlight);
      const normalizedPrintStyle = normalizePrintStyleSettings(settings.printStyle);
      setImageA4TargetWidth(a4TargetWidth);
      setImageEqualPadding(equalPadding);
      setSyntaxHighlight(normalizedSyntaxHighlight);
      setPrintStyle(normalizedPrintStyle);
      const needsSettingsMigration = !Array.isArray(settings.externalApps)
        || settings.externalApps.some((app) => !app || typeof app !== "object" || !("target" in app))
        || settings.imageA4TargetWidth === undefined
        || settings.imageEqualPadding === undefined
        || settings.syntaxHighlight === undefined
        || settings.printStyle === undefined
        || JSON.stringify(settings.documentViewModes) !== JSON.stringify(normalizedDocumentViewModes);
      if (needsSettingsMigration) {
        void saveSettings({ schemaVersion: 4, externalApps: apps, presentationLineThreshold: lineThreshold, imageA4TargetWidth: a4TargetWidth, imageEqualPadding: equalPadding, syntaxHighlight: normalizedSyntaxHighlight, printStyle: normalizedPrintStyle, documentViewModes: normalizedDocumentViewModes }).catch((error) => {
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
      const detail = (event as CustomEvent<{ message?: string; type?: ToastState["type"]; actionLabel?: string; onAction?: ToastState["onAction"] }>).detail;
      if (!detail?.message) return;
      setToast({ id: String(Date.now()), message: detail.message, type: detail.type ?? "info", actionLabel: detail.actionLabel, onAction: detail.onAction });
    };
    window.addEventListener("markdown-toast", handleMarkdownToast);
    return () => window.removeEventListener("markdown-toast", handleMarkdownToast);
  }, []);
  const [contextTab, setContextTab] = useState<{ id: string; x: number; y: number } | null>(null);
  const [closedTabs, setClosedTabs] = useState<ClosedTabState[]>([]);
  const [tabsState, dispatch] = useReducer(tabsReducer, initialTabsState);
  const tabsStateRef = useRef(tabsState);
  tabsStateRef.current = tabsState;
  mediaPreviewRef.current = mediaPreview;
  const [imageVersions, setImageVersions] = useState<Record<string, number>>({});
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeId) ?? null;

  useEffect(() => {
    const next = activeTab?.document ? documentViewModes[activeTab.document.path] ?? "auto" : "auto";
    viewModeRef.current = next;
    setViewMode(next);
  }, [activeTab?.document?.path, documentViewModes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || viewMode === "presentation" || !activeTab?.document) return;
      event.preventDefault();
      updateZoom((current) => current + (event.deltaY < 0 ? 10 : -10));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [activeTab?.document, updateZoom, viewMode]);

  const imageOccurrenceGroups = useMemo(() => {
    if (!activeTab?.document || viewMode === "presentation") return [];
    return groupImageOccurrences(collectImageOccurrences(activeTab.document.content, activeTab.document.base_dir));
  }, [activeTab?.document, viewMode]);
  const imageGalleryItems = useMemo<ImageGalleryItem[]>(() => {
    const baseDir = activeTab?.document?.base_dir;
    if (!baseDir) return [];
    return imageOccurrenceGroups.map((group) => ({
      path: group.path,
      src: resolveImageSrc(group.source, baseDir),
      filename: group.filename,
      occurrences: group.occurrences.map(({ id, caption, sourceLine }) => ({ id, caption, sourceLine })),
    }));
  }, [activeTab?.document?.base_dir, imageOccurrenceGroups]);

  useEffect(() => {
    setActiveImageOccurrenceId(null);
    setActiveTocHeadingId(null);
  }, [activeTab?.id]);

  useEffect(() => {
    if (!activeTab?.document || viewMode === "presentation") return;
    const frame = requestAnimationFrame(() => {
      const first = markdownRef.current?.querySelector<HTMLElement>("[data-fold-id]");
      setActiveTocHeadingId(first?.dataset.foldId ?? null);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab?.document, viewMode]);

  useEffect(() => {
    if (viewMode === "presentation") {
      wasPresentationMode.current = true;
      return;
    }
    if (wasPresentationMode.current) {
      wasPresentationMode.current = false;
      presentationRestorePending.current = true;
    }
    if (!presentationRestorePending.current || !activeTab?.document) return;
    const headingId = presentationPositionsRef.current[activeTab.id];
    if (!headingId) {
      presentationRestorePending.current = false;
      return;
    }
    presentationRestorePending.current = false;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const section = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-fold-id]") ?? [])]
          .find((candidate) => candidate.dataset.foldId === headingId);
        if (!section) return;
        const parentIds = ancestorFoldIds(section);
        if (parentIds.length > 0) {
          setFoldStates((current) => {
            const currentForPath = current[activeTab.path] ?? {};
            const nextForPath = { ...currentForPath };
            let changed = false;
            for (const parentId of parentIds) {
              if (nextForPath[parentId]) {
                nextForPath[parentId] = false;
                changed = true;
              }
            }
            if (!changed) return current;
            void saveFoldState(activeTab.path, nextForPath).catch((error) => setToast({ id: String(Date.now()), message: `折りたたみ状態の保存に失敗しました: ${String(error)}`, type: "error" }));
            return { ...current, [activeTab.path]: nextForPath };
          });
        }
        requestAnimationFrame(() => section.scrollIntoView({ block: "start" }));
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
  const handleCodeHighlightComplete = useCallback(() => {
    setCodeHighlightRevision((revision) => revision + 1);
  }, []);
  const searchRefreshKey = `${tabsState.activeId ?? "empty"}:${activeTab?.generation ?? 0}:${searchExpandedIds.join("|")}:${codeHighlightRevision}`;
  const search = useSearch(markdownRef, `${windowLabel}-${tabsState.activeId ?? "empty"}`, updateSearchExpandedIds, searchRefreshKey, activeTab?.document?.content ?? "");
  const { cropTarget, startCrop, cancelCrop } = useCropEditor();
  useEffect(() => {
    if (!activeTab?.document) { setDiagnostics([]); return; }
    let disposed = false;
    void diagnoseDocument(activeTab.document.path).then((items) => { if (!disposed) setDiagnostics(items); }).catch((error) => {
      if (!disposed) setDiagnostics([{ severity: "warning", kind: "診断", line: 1, reference: activeTab.document!.path, message: `診断を完了できません: ${String(error)}` }]);
    });
    return () => { disposed = true; };
  }, [activeTab?.document?.path, activeTab?.generation]);
  const restoringSearchFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!activeTab) return;
    restoringSearchFor.current = activeTab.id;
    search.setQuery(activeTab.search.query);
    search.setRegex(activeTab.search.regex);
    search.setCaseSensitive(activeTab.search.caseSensitive);
    search.setActiveIndex(activeTab.search.activeIndex);
  }, [activeTab?.id]);

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusAndSelectSearchInput(searchInputRef.current);
    });
  }, []);

  useEffect(() => {
    if (activeTab?.searchOpen) focusSearchInput();
  }, [activeTab?.id, activeTab?.searchOpen, focusSearchInput]);

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
    let unlisten: (() => void) | undefined;
    void listenForSecondaryLaunches((event) => {
      for (const path of event.payload) {
        void openInNewWindow(path).catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
      }
    }).then((dispose) => { unlisten = dispose; });
    return () => { unlisten?.(); };
  }, []);

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
    if (!activeTab?.document) return;
    const sections = [...(markdownRef.current?.querySelectorAll<HTMLElement>(".fold-section[data-fold-id][data-fold-level]") ?? [])];
    if (!sections.length) return;
    setFoldStates((current) => {
      const currentForPath = current[activeTab.path] ?? {};
      const headingStates = sections.flatMap((section) => {
        const id = section.dataset.foldId;
        if (!id) return [];
        return [{
          id,
          level: Number(section.dataset.foldLevel ?? 6),
          collapsed: currentForPath[id] ?? false,
        }];
      });
      const nextForPath = { ...currentForPath, ...toggleNestedFoldStates(headingStates) };
      void saveFoldState(activeTab.path, nextForPath).catch((error) => setToast({ id: String(Date.now()), message: `折りたたみ状態の保存に失敗しました: ${String(error)}`, type: "error" }));
      return { ...current, [activeTab.path]: nextForPath };
    });
  }, [activeTab]);

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

  const captureNavigationSnapshot = useCallback((): NavigationSnapshot => {
    const state = tabsStateRef.current;
    const activeId = state.activeId;
    const tab = state.tabs.find((candidate) => candidate.id === activeId);
    return {
      activeTabId: activeId,
      scrollTop: activeId && containerRef.current ? containerRef.current.scrollTop : tab?.scrollTop ?? 0,
      viewMode: viewModeRef.current,
      presentationHeadingId: activeId ? presentationPositionsRef.current[activeId] ?? null : null,
    };
  }, []);

  const recordNavigationPoint = useCallback(() => {
    navigationHistoryRef.current = recordNavigation(navigationHistoryRef.current, captureNavigationSnapshot());
  }, [captureNavigationSnapshot]);

  const jumpToImageOccurrence = useCallback((occurrenceId: string) => {
    const target = document.getElementById(occurrenceId);
    if (!target || !activeTab?.document) return;
    recordNavigationPoint();
    setActiveImageOccurrenceId(occurrenceId);

    const foldIds: string[] = [];
    let section = target.closest<HTMLElement>("[data-fold-id]");
    while (section) {
      if (section.dataset.foldId) foldIds.push(section.dataset.foldId);
      section = section.parentElement?.closest<HTMLElement>("[data-fold-id]") ?? null;
    }
    if (foldIds.length > 0) {
      setFoldStates((current) => {
        const currentForPath = current[activeTab.path] ?? {};
        const nextForPath = { ...currentForPath };
        let changed = false;
        for (const foldId of foldIds) {
          if (nextForPath[foldId]) {
            nextForPath[foldId] = false;
            changed = true;
          }
        }
        if (!changed) return current;
        void saveFoldState(activeTab.path, nextForPath).catch((error) => setToast({
          id: String(Date.now()),
          message: `折りたたみ状態の保存に失敗しました: ${String(error)}`,
          type: "error",
        }));
        return { ...current, [activeTab.path]: nextForPath };
      });
    }
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(min-width: 860px)").matches) {
      setDocumentPanels((current) => ({ ...current, [activeTab.id]: null }));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: "center" })));
  }, [activeTab?.document, activeTab?.id, activeTab?.path, recordNavigationPoint]);

  const jumpToDocumentHeading = useCallback((headingId: string) => {
    const section = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-fold-id]") ?? [])]
      .find((candidate) => candidate.dataset.foldId === headingId);
    if (!section || !activeTab?.document) return;
    recordNavigationPoint();
    setActiveTocHeadingId(headingId);
    const parentIds = ancestorFoldIds(section);
    if (parentIds.length > 0) {
      setFoldStates((current) => {
        const currentForPath = current[activeTab.path] ?? {};
        const nextForPath = { ...currentForPath };
        let changed = false;
        for (const parentId of parentIds) {
          if (nextForPath[parentId]) {
            nextForPath[parentId] = false;
            changed = true;
          }
        }
        if (!changed) return current;
        void saveFoldState(activeTab.path, nextForPath).catch((error) => setToast({
          id: String(Date.now()),
          message: `折りたたみ状態の保存に失敗しました: ${String(error)}`,
          type: "error",
        }));
        return { ...current, [activeTab.path]: nextForPath };
      });
    }
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(min-width: 860px)").matches) {
      setDocumentPanels((current) => ({ ...current, [activeTab.id]: null }));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => section.scrollIntoView({ block: "start" })));
  }, [activeTab?.document, activeTab?.id, activeTab?.path, recordNavigationPoint]);

  const jumpToSearchResult = useCallback((index: number) => {
    const result = search.results[index];
    if (!result || !activeTab?.document) return;
    search.setActiveIndex(index);
    if (viewModeRef.current === "presentation") {
      recordNavigationPoint();
      if (result.headingId) {
        presentationPositionsRef.current[activeTab.id] = result.headingId;
        setPresentationPositions((current) => ({ ...current, [activeTab.id]: result.headingId! }));
      }
      return;
    }
    if (result.headingId) {
      jumpToDocumentHeading(result.headingId);
    }
  }, [activeTab?.document, activeTab?.id, jumpToDocumentHeading, recordNavigationPoint, search]);

  const jumpToDiagnostic = useCallback((item: DiagnosticItem) => {
    if (!activeTab?.document) return;
    recordNavigationPoint();
    const lines = activeTab.document.content.split(/\r?\n/);
    const needle = lines[item.line - 1]?.trim();
    const target = [...(markdownRef.current?.querySelectorAll<HTMLElement>(".markdown-body *") ?? [])]
      .find((element) => element.childElementCount === 0 && element.textContent?.trim() === needle);
    target?.scrollIntoView({ block: "center" });
  }, [activeTab?.document, recordNavigationPoint]);

  const handlePreviewScroll = useCallback((element: HTMLElement) => {
    if (activeTab) dispatch({ type: "SCROLL", id: activeTab.id, scrollTop: element.scrollTop });
    if (viewModeRef.current === "presentation") return;
  }, [activeTab?.id]);

  const handlePreviewPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (viewModeRef.current === "presentation") return;
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const section = target?.closest<HTMLElement>("[data-fold-id]");
    const headingId = section?.dataset.foldId ?? null;
    if (!headingId) return;
    pendingTocHeadingId.current = headingId;
    if (tocPointerFrame.current) return;
    tocPointerFrame.current = window.requestAnimationFrame(() => {
      tocPointerFrame.current = 0;
      const pending = pendingTocHeadingId.current;
      if (pending) setActiveTocHeadingId((previous) => previous === pending ? previous : pending);
    });
  }, []);

  useEffect(() => () => { if (tocPointerFrame.current) window.cancelAnimationFrame(tocPointerFrame.current); }, []);

  const restoreNavigationSnapshot = useCallback((snapshot: NavigationSnapshot) => {
    if (snapshot.activeTabId && tabsStateRef.current.tabs.some((tab) => tab.id === snapshot.activeTabId)) {
      dispatch({ type: "SCROLL", id: snapshot.activeTabId, scrollTop: snapshot.scrollTop });
      dispatch({ type: "ACTIVATE", id: snapshot.activeTabId });
      if (snapshot.presentationHeadingId) {
        presentationPositionsRef.current[snapshot.activeTabId] = snapshot.presentationHeadingId;
        setPresentationPositions((current) => ({ ...current, [snapshot.activeTabId!]: snapshot.presentationHeadingId! }));
      }
    }
    if (viewModeRef.current !== snapshot.viewMode) {
      viewModeRef.current = snapshot.viewMode;
      setViewMode(snapshot.viewMode);
      const documentPath = snapshot.activeTabId
        ? tabsStateRef.current.tabs.find((tab) => tab.id === snapshot.activeTabId)?.document?.path
        : undefined;
      if (documentPath) {
        const next = { ...documentViewModesRef.current, [documentPath]: snapshot.viewMode };
        documentViewModesRef.current = next;
        setDocumentViewModes(next);
        void saveSettings({ documentViewModes: next }).catch((error) => {
          setToast({ id: String(Date.now()), message: `レイアウト設定の保存に失敗しました: ${String(error)}`, type: "error" });
        });
      }
    }
    setMediaPreview(null);
  }, []);

  const goBack = useCallback(() => {
    const result = navigateBack(navigationHistoryRef.current, captureNavigationSnapshot());
    navigationHistoryRef.current = result.history;
    if (result.target) restoreNavigationSnapshot(result.target);
  }, [captureNavigationSnapshot, restoreNavigationSnapshot]);

  const goForward = useCallback(() => {
    const result = navigateForward(navigationHistoryRef.current, captureNavigationSnapshot());
    navigationHistoryRef.current = result.history;
    if (result.target) restoreNavigationSnapshot(result.target);
  }, [captureNavigationSnapshot, restoreNavigationSnapshot]);

  const handleOpenDocument = useCallback((path: string) => {
    const identity = localPathIdentity(path);
    const existing = tabsStateRef.current.tabs.find((tab) => tab.kind !== "settings" && localPathIdentity(tab.path) === identity);
    if (existing?.id === tabsStateRef.current.activeId) return;
    recordNavigationPoint();
    dispatch({ type: "OPEN", path });
  }, [recordNavigationPoint]);
  useFileDrop((paths) => paths.forEach(handleOpenDocument));

  const openMediaPreview = useCallback((target: MediaPreviewTarget) => {
    setMediaPreview(target);
  }, []);

  const closeMediaPreview = useCallback(() => {
    if (!mediaPreviewRef.current) return;
    setMediaPreview(null);
  }, []);

  const saveImageCaption = useCallback(async (context: ImageEditContext, caption: string) => {
    await updateImageCaption({
      markdownPath: context.markdownPath,
      sourceOffset: context.sourceOffset,
      expectedSource: context.source,
      caption,
    });
    const matchingTabs = tabsStateRef.current.tabs.filter((tab) => localPathIdentity(tab.path) === localPathIdentity(context.markdownPath));
    matchingTabs.forEach((tab) => dispatch({ type: "RELOAD", id: tab.id }));
    setMediaPreview((current) => current?.imageContext ? {
      ...current,
      content: { ...current.content, alt: caption },
      imageContext: { ...current.imageContext, caption },
    } : current);
    setToast({ id: String(Date.now()), message: "キャプションを保存しました", type: "success" });
  }, []);

  const renamePreviewImage = useCallback(async (context: ImageEditContext, filename: string) => {
    const result = await renameImageAndReferences({
      markdownPath: context.markdownPath,
      imagePath: context.imagePath,
      newFilename: filename,
    });
    const changed = new Set(result.updatedDocuments.map(localPathIdentity));
    tabsStateRef.current.tabs
      .filter((tab) => changed.has(localPathIdentity(tab.path)))
      .forEach((tab) => dispatch({ type: "RELOAD", id: tab.id }));
    setMediaPreview(null);
    setToast({
      id: String(Date.now()),
      message: `${result.updatedDocuments.length}文書・${result.updatedReferences}箇所の画像参照とファイル名を更新しました`,
      type: "success",
    });
  }, []);

  const handleImageDisplaySizeChange = useCallback((source: string, size: ImageSize) => {
    if (activeTab) dispatch({ type: "IMAGE_DISPLAY_SIZE", id: activeTab.id, source, size });
  }, [activeTab?.id]);

  const executeExternalApp = useCallback((app: ExternalAppConfig) => {
    if (!activeTab?.document) return;
    const visibleSourceLine = () => {
      const rootTop = containerRef.current?.getBoundingClientRect().top ?? 0;
      const blocks = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-source-line]") ?? [])];
      const nearest = blocks.reduce<HTMLElement | null>((best, block) => {
        const top = block.getBoundingClientRect().top;
        if (top > rootTop + 1) return best;
        return !best || top > best.getBoundingClientRect().top ? block : best;
      }, null) ?? blocks[0];
      return Math.max(1, Number(nearest?.dataset.sourceLine) || 1);
    };
    const line = viewModeRef.current === "presentation"
      ? presentationSourceLines.current[activeTab.id] ?? 1
      : visibleSourceLine();
    const operation = app.builtinKind === "folder"
      ? openContainingFolder(activeTab.path)
      : app.builtinKind === "vscode" || app.builtinKind === "notepad"
        ? openInEditor(activeTab.path, app.builtinKind)
        : openExternalApp({
          executable: app.executable,
          args: app.args,
          workingDirectory: app.workingDirectory || undefined,
          file: activeTab.path,
          line,
        });
    void operation.catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
  }, [activeTab?.document, activeTab?.path]);

  const executeImageApp = useCallback((app: ExternalAppConfig, context: ImageEditContext) => {
    const operation = openExternalApp({
      executable: app.executable,
      args: app.args,
      workingDirectory: app.workingDirectory || undefined,
      file: context.imagePath,
    });
    void operation.catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
  }, []);

  const openSettings = useCallback(() => {
    recordNavigationPoint();
    dispatch({ type: "OPEN_SETTINGS" });
  }, [recordNavigationPoint]);

  const saveExternalAppSettings = useCallback(async (apps: ExternalAppConfig[], lineThreshold: number, a4TargetWidth: number, equalPadding: number, nextSyntaxHighlight: SyntaxHighlightSettings, nextPrintStyle: PrintStyleSettings) => {
    try {
      const previousById = new Map(externalApps.map((app) => [app.id, app]));
      const upserts = apps.filter((app) => JSON.stringify(previousById.get(app.id)) !== JSON.stringify(app));
      const nextIds = new Set(apps.map((app) => app.id));
      const removedIds = externalApps.filter((app) => !nextIds.has(app.id)).map((app) => app.id);
      const saved = await updateExternalAppSettings(upserts, removedIds, lineThreshold, a4TargetWidth, equalPadding);
      const normalizedSyntaxHighlight = normalizeSyntaxHighlightSettings(nextSyntaxHighlight);
      const normalizedPrintStyle = normalizePrintStyleSettings(nextPrintStyle);
      await saveSettings({ syntaxHighlight: normalizedSyntaxHighlight, printStyle: normalizedPrintStyle });
      setExternalApps(normalizeExternalApps(saved.externalApps));
      setPresentationLineThreshold(lineThreshold);
      setImageA4TargetWidth(a4TargetWidth);
      setImageEqualPadding(equalPadding);
      setSyntaxHighlight(normalizedSyntaxHighlight);
      setPrintStyle(normalizedPrintStyle);
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
    recordNavigationPoint();
    dispatch({ type: "ACTIVATE", id: tabsState.tabs[(index + delta + tabsState.tabs.length) % tabsState.tabs.length].id });
  }, [recordNavigationPoint, tabsState.activeId, tabsState.tabs]);

  const activateTab = useCallback((id: string) => {
    if (id === tabsStateRef.current.activeId) return;
    recordNavigationPoint();
    dispatch({ type: "ACTIVATE", id });
  }, [recordNavigationPoint]);

  const changeViewMode = useCallback((value: ViewMode) => {
    const documentPath = activeTab?.document?.path;
    if (!documentPath || viewModeRef.current === value) return;
    recordNavigationPoint();
    const next = { ...documentViewModesRef.current, [documentPath]: value };
    documentViewModesRef.current = next;
    setDocumentViewModes(next);
    viewModeRef.current = value;
    setViewMode(value);
    void saveSettings({ documentViewModes: next }).catch((error) => {
      setToast({ id: String(Date.now()), message: `レイアウト設定の保存に失敗しました: ${String(error)}`, type: "error" });
    });
  }, [activeTab?.document?.path, recordNavigationPoint]);

  const openSearch = useCallback(() => {
    if (activeTab?.document) {
      panelBeforeSearchRef.current[activeTab.id] = documentPanelsRef.current[activeTab.id] ?? null;
      dispatch({ type: "SEARCH_VISIBILITY", id: activeTab.id, open: true });
    }
    focusSearchInput();
  }, [activeTab, focusSearchInput]);

  const closeSearch = useCallback(() => {
    if (!activeTab) return;
    search.clear();
    dispatch({ type: "SEARCH_VISIBILITY", id: activeTab.id, open: false });
    const restore = panelBeforeSearchRef.current[activeTab.id] ?? null;
    setDocumentPanels((current) => ({ ...current, [activeTab.id]: restore }));
    delete panelBeforeSearchRef.current[activeTab.id];
  }, [activeTab, search]);

  const changeDocumentSidePanel = useCallback((panel: DocumentSidePanelTab | null) => {
    if (!activeTab?.document) return;
    if (panel === "search") {
      openSearch();
      return;
    }
    if (activeTab.searchOpen) {
      search.clear();
      dispatch({ type: "SEARCH_VISIBILITY", id: activeTab.id, open: false });
      delete panelBeforeSearchRef.current[activeTab.id];
    }
    setDocumentPanels((current) => ({ ...current, [activeTab.id]: panel }));
  }, [activeTab, openSearch, search]);

  const closeDocumentSidePanel = useCallback(() => {
    if (!activeTab) return;
    if (activeTab.searchOpen) {
      search.clear();
      dispatch({ type: "SEARCH_VISIBILITY", id: activeTab.id, open: false });
      delete panelBeforeSearchRef.current[activeTab.id];
    }
    setDocumentPanels((current) => ({ ...current, [activeTab.id]: null }));
  }, [activeTab, search]);

  const printDocument = useCallback(async () => {
    if (!activeTab?.document || printing) return;
    setPrinting(true);
    const deadline = Date.now() + 5000;
    while (getMermaidStatus().pending > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    if (getMermaidStatus().pending > 0) setToast({ id: String(Date.now()), message: "Mermaidの描画待機がタイムアウトしたため、現在の状態で印刷します。", type: "info" });
    const restore = () => setPrinting(false);
    window.addEventListener("afterprint", restore, { once: true });
    try { window.print(); window.setTimeout(restore, 1000); } catch (error) { restore(); setToast({ id: String(Date.now()), message: `印刷を開始できません: ${String(error)}`, type: "error" }); }
  }, [activeTab?.document, printing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isShortcutHelpShortcut(event)) {
        event.preventDefault();
        setShortcutHelpOpen(true);
        return;
      }
      if (shortcutHelpOpen) return;
      if (annotationTarget) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        if (event.key === "ArrowLeft") goBack();
        else goForward();
        return;
      }

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
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void printDocument();
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
      } else if (isZoomInShortcut(event)) {
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
  }, [activeTab?.searchOpen, activateRelativeTab, annotationTarget, closeActiveTab, closeSearch, closedTabs, cropTarget, goBack, goForward, openSearch, printDocument, reload, search, shortcutHelpOpen, toggleFoldAll, updateZoom]);

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      const result = acceptAuxiliaryNavigation(auxiliaryNavigationRef.current, event.button, Date.now());
      auxiliaryNavigationRef.current = result.next;
      if (!result.accepted) return;
      if (event.button === 3) goBack();
      else goForward();
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [goBack, goForward]);

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

  const requestedDocumentPanel = activeTab ? documentPanels[activeTab.id] ?? null : null;
  const documentSidePanel = activeTab?.document
    ? resolveDocumentSidePanel(Boolean(activeTab.searchOpen), viewMode === "presentation" ? null : requestedDocumentPanel)
    : null;

  return (
    <div className={`app-container${printing ? " is-printing" : ""}`}>
      <TabBar tabs={tabsState.tabs} activeId={tabsState.activeId} onActivate={activateTab} onClose={closeTab} onMove={(id, toIndex) => dispatch({ type: "MOVE", id, toIndex })} onContext={(id, x, y) => setContextTab({ id, x, y })} />
      {activeTab?.kind !== "settings" && <div className="view-controls" aria-label="表示と文書の操作">
        <div className="control-group document-actions">
          <button type="button" disabled={!activeTab?.document || printing} onClick={() => void printDocument()}>印刷/PDF</button>
          <DiagnosticsPanel items={diagnostics} isOpen={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} onSelect={jumpToDiagnostic} />
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
        <ExternalActions
          apps={externalApps.filter((app) => app.target === "document")}
          disabled={!activeTab?.document}
          onExecute={executeExternalApp}
          onOpenInNewWindow={() => {
            if (!activeTab?.document) return;
            void openInNewWindow(activeTab.path).catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
          }}
        />
        {autoReload === "manual" && activeTab?.externalChanged && <button type="button" className="pending-reload" onClick={reload}>変更あり: 再読み込み</button>}
      </div>}

      <div className="document-workspace">
      {activeTab?.document && <DocumentSidePanel
        activeTab={documentSidePanel}
        onTabChange={changeDocumentSidePanel}
        onClose={documentSidePanel === "search" ? closeSearch : closeDocumentSidePanel}
        disabledTabs={viewMode === "presentation" ? ["toc", "images"] : []}
        toc={<DocumentToc
          markdown={activeTab.document.content}
          isOpen
          embedded
          activeHeadingId={activeTocHeadingId ?? undefined}
          onOpenChange={() => undefined}
          onJump={jumpToDocumentHeading}
        />}
        search={<div className="document-side-panel__search">
          <SearchBar search={search} inputRef={searchInputRef} onClose={closeSearch} embedded />
          {search.results.length > 0
            ? <SearchResults results={search.results} activeIndex={search.activeIndex} truncated={search.truncated} onSelect={search.setActiveIndex} onActivate={(result) => jumpToSearchResult(result.index)} />
            : <p className="document-side-panel__empty">{search.query ? "一致する結果はありません。" : "検索語を入力してください。"}</p>}
        </div>}
        images={<ImageGallery
          items={imageGalleryItems}
          activeOccurrenceId={activeImageOccurrenceId ?? undefined}
          onJump={jumpToImageOccurrence}
          isOpen
          embedded
          onOpenChange={() => undefined}
        />}
      />}
      <main className={`preview-container ${activeTab?.kind === "settings" ? "view-settings" : `view-${viewMode}`}`} ref={containerRef} onScroll={(event) => handlePreviewScroll(event.currentTarget)} onPointerMove={handlePreviewPointerMove} style={{ zoom: viewMode === "presentation" && activeTab?.kind !== "settings" ? 1 : zoom / 100 }}>
        {activeTab?.kind === "settings" ? (
          <SettingsPanel
            apps={externalApps}
            presentationLineThreshold={presentationLineThreshold}
            imageA4TargetWidth={imageA4TargetWidth}
            imageEqualPadding={imageEqualPadding}
            syntaxHighlight={syntaxHighlight}
            printStyle={printStyle}
            onSave={saveExternalAppSettings}
          />
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
            theme={theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
            onError={handlePreviewError}
            mermaidMode={mermaidMode}
            windowId={windowLabel}
            tabId={activeTab.id}
            imageDisplaySizes={activeTab.imageDisplaySizes}
            onOpenDocument={handleOpenDocument}
            lineThreshold={presentationLineThreshold}
            initialHeadingId={presentationPositions[activeTab.id]}
            onPageChange={(headingId, sourceLine) => {
              presentationPositionsRef.current[activeTab.id] = headingId;
              setPresentationPositions((current) => current[activeTab.id] === headingId ? current : { ...current, [activeTab.id]: headingId });
              presentationSourceLines.current[activeTab.id] = sourceLine;
            }}
            onBeforeNavigate={recordNavigationPoint}
            onMediaOpen={openMediaPreview}
          />
        ) : activeTab?.document ? (
          <MarkdownPreview
            content={activeTab.document.content}
            baseDir={activeTab.document.base_dir}
            imageVersions={imageVersions}
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
            onMediaOpen={openMediaPreview}
            documentPath={activeTab.path}
            onCodeHighlightComplete={handleCodeHighlightComplete}
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
      </div>

      {cropTarget && (
        <CropOverlay
          target={cropTarget}
          onApply={handleCropApply}
          onCancel={cancelCrop}
          onError={handleCropError}
          a4TargetWidth={imageA4TargetWidth}
          equalPadding={imageEqualPadding}
        />
      )}
      {annotationTarget && <ImageAnnotationEditor
        target={annotationTarget}
        imageVersion={imageVersions[annotationTarget.fullPath] ?? 0}
        onApply={(filename, backupAvailable) => {
          updateImageVersion(annotationTarget.fullPath);
          setImageBackups((current) => ({ ...current, [annotationTarget.fullPath]: backupAvailable }));
          setAnnotationTarget(null);
          setToast({
            id: String(Date.now()),
            message: `${filename} の注釈を保存しました`,
            type: "success",
            restorePath: backupAvailable ? annotationTarget.fullPath : undefined,
          });
        }}
        onCancel={() => setAnnotationTarget(null)}
        onError={handleCropError}
      />}

      <Toast
        toast={toast}
        onRestore={handleRestore}
        onClose={() => setToast(null)}
      />
      {mediaPreview && <MediaPreviewModal
        content={mediaPreview.content}
        mermaidSource={mediaPreview.mermaidSource}
        imageContext={mediaPreview.imageContext}
        onSaveCaption={saveImageCaption}
        onRenameImage={renamePreviewImage}
        imageApps={externalApps.filter((app) => app.target === "image")}
        onOpenImageApp={executeImageApp}
        onClose={closeMediaPreview}
        onActivate={mediaPreview.cropTarget ? () => {
          setMediaPreview(null);
          setAnnotationTarget(mediaPreview.cropTarget!);
        } : undefined}
        onCrop={mediaPreview.cropTarget ? () => {
          setMediaPreview(null);
          startCrop(mediaPreview.cropTarget!);
        } : undefined}
      />}
      {shortcutHelpOpen && <ShortcutHelpModal onClose={() => setShortcutHelpOpen(false)} />}
      <StatusBar
        document={activeTab?.document ?? null}
        autoReload={autoReload}
        onAutoReloadChange={updateAutoReload}
        zoom={viewMode === "presentation" && activeTab?.kind !== "settings" ? 100 : zoom}
        onZoomChange={viewMode === "presentation" && activeTab?.kind !== "settings" ? undefined : updateZoom}
        mermaidMode={mermaidMode}
        onMermaidModeChange={updateMermaidMode}
        mermaidStatus={mermaidStatus.pending ? `描画中 ${mermaidStatus.pending}` : mermaidStatus.error ? "エラー" : mermaidStatus.rendered ? `描画済み ${mermaidStatus.rendered}` : "対象なし"}
        mermaidErrorCount={mermaidStatus.errorCount}
        imageBackupAvailable={activeImageBackupAvailable}
        changed={activeTab?.externalChanged ?? false}
        theme={theme}
        onThemeChange={updateTheme}
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        onOpenSettings={openSettings}
        onOpenShortcutHelp={() => setShortcutHelpOpen(true)}
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
