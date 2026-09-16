import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as showOpenDialog, save as showSaveDialog } from "@tauri-apps/plugin-dialog";
import { TabBar } from "./components/TabBar";
import { DesktopHtmlExport } from "./components/DesktopHtmlExport";
import { ContextMenu } from "./components/ContextMenu";
import { PreviewContextMenu } from "./components/PreviewContextMenu";
import { StatusBar } from "./components/StatusBar";
import { MarkdownPreview, type ExternalFileRenameContext, type ExternalTableChangeContext } from "./components/MarkdownPreview";
import { StandaloneDocumentPreview } from "./components/StandaloneDocumentPreview";
import { WorkspaceViewControls, type PreviewMode, type SplitDirection } from "./components/WorkspaceViewControls";
import { DocumentSaveContext } from "./contexts/DocumentSaveContext";
import { CropOverlay } from "./components/CropOverlay";
import { Toast } from "./components/Toast";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { SettingsPanel } from "./components/SettingsPanel";
import { SharePointAuthDialog } from "./components/SharePointAuthDialog";
import { ExternalActions } from "./components/ExternalActions";
import { PresentationView } from "./components/PresentationView";
import { MediaPreviewModal, type ImageEditContext, type MediaPreviewTarget, type MediaPreviewViewState } from "./components/MediaPreviewModal";
import { ImageGallery, type ImageGalleryItem } from "./components/ImageGallery";
import { ImageAnnotationEditor } from "./components/ImageAnnotationEditor";
import { SvgSourceEditor, type SvgSourceEditTarget } from "./components/SvgSourceEditor";
import { ShortcutHelpModal } from "./components/ShortcutHelpModal";
import { DocumentToc } from "./components/DocumentToc";
import { DocumentSidePanel, type DocumentSidePanelTab } from "./components/DocumentSidePanel";
import { CodexPanel } from "./features/codex/CodexPanel";
import type { CodexTarget } from "./features/codex/scope";
import { DiagnosticsPanel, type DiagnosticItem } from "./components/DiagnosticsPanel";
import { DocumentDiffWorkspace, type DocumentDiffTarget, type DiffSaveReview } from "./components/DocumentDiffWorkspace";
import type { MarkdownEditorHandle } from "./components/MarkdownEditor";
import { useCropEditor, type ImageEditTarget } from "./hooks/useCropEditor";
import type { ImageSize } from "./hooks/useInlineImageResize";
import { useSearch } from "./hooks/useSearch";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useFileDrop } from "./hooks/useFileDrop";
import { useApplicationSettings } from "./hooks/useApplicationSettings";
import { useSharePointAuthentication } from "./hooks/useSharePointAuthentication";
import { createMarkdown, deleteDocumentAsset, diagnoseDocument, discardStagedAssets, documentWatchTargets, getInitialFiles, hasImageBackup, loadMarkdown, openContainingFolder, openExternalApp, openInEditor, openInNewWindow, readDocumentAsset, removeWindowWatchTargets, renameDocument, renameImageAndReferences, reportDebugWindowState, restoreImage, saveFoldState, saveMarkdown, saveSettings, saveSharePointAsset, stageClipboardImage, stageDocumentAsset, syncWatchTargets, updateImageCaption, updateStagedTextAsset } from "./lib/commands";
import { ToastState, type MarkdownLoadResult } from "./types/app";
import { ClosedTabState, initialTabsState, tabsReducer, type EditorWorkspaceMode, type TabsAction } from "./state/tabsReducer";
import { getMermaidStatus, subscribeMermaidStatus } from "./lib/mermaidStatus";
import { captureScrollAnchor, restoreScrollAnchor, type SemanticScrollAnchor } from "./lib/scrollAnchor";
import { ancestorFoldIds, toggleNestedFoldStates } from "./lib/foldSections";
import { codeFenceTitle, replaceCodeFenceBody, replaceMarkdownOccurrence, type CodeFenceOccurrence, type EditableMarkdownOccurrence, type MarkdownTableOccurrence } from "./lib/markdownOccurrences";
import { normalizedAssetFilename, parseRasterDataUri, preferredAssetFilename, replaceImageOccurrenceSource, type AssetConversionContext } from "./lib/assetConversion";
import { sanitizeSvgXml } from "./lib/svgSafety";
import { relocateUnchangedOccurrence, replaceBestEffortOccurrence, replaceRelocatedOccurrence } from "./lib/immediateMarkdownMutation";
import { rebaseRenamedExternalReferences } from "./lib/externalFile";
import type { ExternalAppConfig } from "./types/settings";
import { emptyNavigationHistory, navigateBack, navigateForward, recordNavigation, type NavigationSnapshot } from "./lib/navigationHistory";
import { documentSourceIdentity, localPathIdentity } from "./lib/pathIdentity";
import { collectImageOccurrences, groupImageOccurrences } from "./lib/imageOccurrences";
import { getFileName, resolveImageSrc, resolveLocalImagePath } from "./lib/path";
import { acceptAuxiliaryNavigation, isShortcutHelpShortcut, isZoomInShortcut, type AuxiliaryNavigationStamp } from "./lib/shortcuts";
import type { ViewMode } from "./lib/viewMode";
import type { TableStorageConversionContext } from "./lib/tableStorage";
import type { TextStorageConversionContext } from "./lib/textStorage";
import { sourceExtensionForLanguage, textExternalReference } from "./lib/textStorage";
import { appendFilenameExtension, embeddedFenceWithPath, markdownContinuationPrefix, normalizeRelativeAssetPath, removeFilenameExtension } from "./lib/externalPathRepresentation";
import { listenForSecondaryLaunches } from "./lib/secondaryLaunchEvents";
import { isSharePointDocument } from "./lib/sharePoint";
import { moveZoomLevel } from "./lib/zoom";
import { moveHeadingBlock } from "./lib/markdownEditing";
import { buildPresentationModel } from "./lib/presentationModel";
import { buildDebugWindowState } from "./lib/debugState";
import { clipboardImageDestination, formatClipboardImageFilename, referencedStagedAssetIds, type ClipboardImageData, type ResolvedClipboardImage } from "./lib/clipboardImage";
import { scopeMarkdownStyleCss } from "./lib/markdownStyle";
import { saveUntitledDocument } from "./lib/untitledDocument";
import { drawioExternalReference, markdownLineEnding, type DrawioStorageConversionContext } from "./lib/drawioStorage";
import { mermaidExternalReference, type MermaidStorageConversionContext } from "./lib/mermaidStorage";
import { scrollDeltaForViewportAnchor, sourceBlockIndexForLine, sourceLineAtViewportTop, sourceTopForLine, synchronizedPaneEndScrollTop, type EditorCursorPosition } from "./lib/paneSync";

import { previewClipboardData } from "./lib/previewClipboard";
import { PreviewEditHistory, replaceDocumentText } from "./lib/documentTextEdit";
import { foldIdsForElement, nearestRenderedSourceBlock, sourceAnchorForLine } from "./lib/sourceNavigation";
import { useDocumentPrint } from "./hooks/useDocumentPrint";
import { PrintMetadata } from "./components/PrintMetadata";
import { createDocumentStorageRefresh } from "./lib/documentStorageRefresh";
import { startDeletedDocumentRecovery } from "./lib/deletedDocumentRecovery";
import { documentDiffTarget } from "./lib/documentDiffTarget";
import { documentDiffProtectsDraft, documentDiffSavePermission } from "./lib/documentDiffSave";
import "./styles/app.css";
import "./styles/content.css";
import "./styles/crop.css";
import "./styles/themes.css";
import "./styles/syntax-highlight.css";

// Keep this list in sync with StatusBar's fixed zoom choices.  Normalizing at
// the state boundary also repairs legacy persisted values that were not a
// selectable option.
export { moveZoomLevel, normalizeZoom, ZOOM_LEVELS, type ZoomLevel } from "./lib/zoom";

const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));
const EditingTestReport = lazy(() => import("./components/EditingTestReport").then((module) => ({ default: module.EditingTestReport })));

export function focusAndSelectSearchInput(input: HTMLInputElement | null): void {
  input?.focus();
  input?.select();
}

export function documentLinkTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || !link.closest(".markdown-body")) return null;
  return link.getAttribute("href");
}

export function tocHeadingIdAtPointer(target: Element | null, markdownRoot: HTMLElement | null): string | null {
  if (!target || !markdownRoot || !markdownRoot.contains(target)) return null;
  return target.closest<HTMLElement>("[data-fold-id]")?.dataset.foldId ?? null;
}

export function resolveDocumentSidePanel(searchOpen: boolean, requestedPanel: Exclude<DocumentSidePanelTab, "search"> | null): DocumentSidePanelTab | null {
  if (searchOpen) return "search";
  return requestedPanel;
}

export function resolveDocumentPanelForView(viewMode: ViewMode, requestedPanel: Exclude<DocumentSidePanelTab, "search"> | null): Exclude<DocumentSidePanelTab, "search"> | null {
  return viewMode === "presentation" && requestedPanel === "images" ? null : requestedPanel;
}

export function canEditMarkdownDocument(document: { kind: string } | null | undefined): boolean {
  return document?.kind === "markdown" || document?.kind === "tsv";
}

export function shouldBlockF5Reload(tab: { dirty: boolean } | null | undefined): boolean {
  return Boolean(tab?.dirty);
}

interface PreviewContextState {
  x: number;
  y: number;
  line: number;
  plainText: string;
  markdownText: string;
  rowElement: HTMLTableRowElement | null;
  rowTsv: string;
}

function previewSourceBlocks(root: HTMLElement | null, visibleOnly = false): HTMLElement[] {
  const seen = new Set<number>();
  return [...(root?.querySelectorAll<HTMLElement>("[data-source-line]") ?? [])].filter((block) => {
    const line = Number(block.dataset.sourceLine);
    if (!Number.isFinite(line) || line < 1 || seen.has(line)) return false;
    if (visibleOnly && block.getClientRects().length === 0) return false;
    seen.add(line);
    return true;
  });
}

function previewSourceLineAtNode(node: Node | null, root: HTMLElement): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const block = element?.closest<HTMLElement>("[data-source-line]");
  if (!block || !root.contains(block)) return null;
  const line = Number(block.dataset.sourceLine);
  return Number.isFinite(line) && line >= 1 ? line : null;
}

export function previewSelectionSourceRange(selection: Selection | null, root: HTMLElement, sourceLines: readonly number[], fallbackLine: number): { inside: boolean; firstLine: number; lastLine: number } {
  const inside = Boolean(selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode
    && root.contains(selection.anchorNode) && root.contains(selection.focusNode));
  const range = inside && selection!.rangeCount > 0 ? selection!.getRangeAt(0) : null;
  return {
    inside,
    firstLine: range ? previewSourceLineAtNode(range.startContainer, root) ?? sourceLines[0] ?? fallbackLine : fallbackLine,
    lastLine: range ? previewSourceLineAtNode(range.endContainer, root) ?? sourceLines[sourceLines.length - 1] ?? fallbackLine : fallbackLine,
  };
}

/** True while the browser owns a non-empty text selection inside View. */
export function hasPreviewTextSelection(selection: Selection | null, root: HTMLElement | null): boolean {
  return Boolean(root && selection && !selection.isCollapsed && selection.toString().length > 0
    && selection.anchorNode && selection.focusNode
    && root.contains(selection.anchorNode) && root.contains(selection.focusNode));
}

export function applicationWindowTitle(tab: { kind?: "document" | "settings"; path: string } | null | undefined): string {
  if (!tab) return "MdVisualizer";
  if (tab.kind === "settings") return "設定 - MdVisualizer";
  const segments = tab.path.split(/[\\/]/).filter(Boolean);
  const filename = segments[segments.length - 1] ?? tab.path;
  return `${filename} - MdVisualizer`;
}

export async function handleWindowCloseRequest(
  hasUnsavedChanges: boolean,
  confirmDiscard: (message?: string) => boolean,
  event: { preventDefault: () => void },
  destroyWindow: () => Promise<void>,
) {
  event.preventDefault();
  if (hasUnsavedChanges && !confirmDiscard("未保存の編集内容があります。破棄してアプリを終了しますか？")) return;
  await destroyWindow();
}

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const [codexMaximized, setCodexMaximized] = useState(false);
  const previewEditHistory = useRef(new PreviewEditHistory());
  const [codexTarget, setCodexTarget] = useState<CodexTarget | null>(null);
  const [codexImageTarget, setCodexImageTarget] = useState<{ documentId: string; offset: number } | null>(null);
  const codexButtonRef = useRef<HTMLButtonElement>(null);
  const focusNewDocumentRef = useRef(false);
  const paneSyncOrigin = useRef<"edit" | "view" | null>(null);
  const paneSyncFrame = useRef(0);
  // エディター追従のために設定したViewのscrollTopを、View→コード同期へ
  // 反射させない。値を比較して消費するため、イベントの発火順に依存しない。
  const pendingPreviewScrollTop = useRef<{ value: number; until: number } | null>(null);
  const pendingEditorLine = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightLoads = useRef(new Set<string>());
  const recentSelfSaves = useRef(new Map<string, number>());
  const reloadAnchors = useRef<Record<string, SemanticScrollAnchor>>({});
  const [presentationPositions, setPresentationPositions] = useState<Record<string, string>>({});
  const [presentationSearchLines, setPresentationSearchLines] = useState<Record<string, number>>({});
  const presentationPositionsRef = useRef<Record<string, string>>({});
  const presentationSourceLines = useRef<Record<string, number>>({});
  const wasPresentationMode = useRef(false);
  const presentationRestorePending = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("auto");
  const [searchExpandedIds, setSearchExpandedIds] = useState<string[]>([]);
  const [codeHighlightRevision, setCodeHighlightRevision] = useState(0);
  const [mermaidStatus, setMermaidStatus] = useState(getMermaidStatus);
  const [imageBackups, setImageBackups] = useState<Record<string, boolean>>({});
  const {
    theme,
    zoom,
    documentViewModes,
    setDocumentViewModes,
    autoReload,
    foldStates,
    setFoldStates,
    externalApps,
    presentationLineThreshold,
    codeBlockFoldMinLines,
    imageA4TargetWidth,
    imageEqualPadding,
    clipboardImage,
    embeddedPathStyle,
    syntaxHighlight,
    printStyle,
    markdownStyle,
    markdownStyleCss,
    markdownStylePath,
    updateTheme,
    updateZoom,
    updateAutoReload,
    saveExternalAppSettings,
    reloadMarkdownStyle,
    openMarkdownStyleFile,
  } = useApplicationSettings(setToast);

  const {
    sharePointAuthPrompt,
    openAuthenticationPage,
    dismissAuthentication,
  } = useSharePointAuthentication(setToast);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewTarget | null>(null);
  const [mediaPreviewInitialViewState, setMediaPreviewInitialViewState] = useState<MediaPreviewViewState | null>(null);
  const [documentDiff, setDocumentDiff] = useState<DocumentDiffTarget | null>(null);
  const diffReviewRef = useRef<DiffSaveReview | null>(null);
  const storageConversionPromptedRef = useRef(new Set<string>());
  const updateDiffReview = useCallback((review: DiffSaveReview | null) => { diffReviewRef.current = review; }, []);
  const confirmStorageConversion = useCallback((context: { documentPath: string; occurrence: { start: number }; storage: "embedded" | "external" }) => {
    const key = `${localPathIdentity(context.documentPath)}:${context.occurrence.start}`;
    if (storageConversionPromptedRef.current.has(key)) return true;
    const direction = context.storage === "embedded" ? "埋め込みデータを外部ファイルへ切り替えます" : "外部ファイルをMarkdownへ埋め込みます";
    if (!window.confirm(`${direction}。内容を書き換えて即時保存します。続行しますか？`)) return false;
    storageConversionPromptedRef.current.add(key);
    return true;
  }, []);
  const deleteConvertedExternalAsset = useCallback(async (documentPath: string, source: string, expectedRevision?: string) => {
    try {
      await deleteDocumentAsset({ documentPath, source, expectedRevision });
      setToast({ id: crypto.randomUUID(), message: `${source} を削除しました。`, type: "success" });
    } catch (error) {
      setToast({ id: crypto.randomUUID(), message: `外部ファイルを削除できませんでした: ${error instanceof Error ? error.message : String(error)}`, type: "error" });
    }
  }, []);
  const stageConversionAsset = useCallback(async (request: { documentPath: string; preferredFilename: string; preferredSource?: string; base64?: string; text?: string }) => {
    if (!request.preferredSource) return stageDocumentAsset(request);
    let existing: Awaited<ReturnType<typeof readDocumentAsset>> | null = null;
    try { existing = await readDocumentAsset(request.documentPath, request.preferredSource); } catch { /* new target */ }
    if (!existing) return stageDocumentAsset(request);
    const same = request.text !== undefined
      ? existing.text === request.text
      : Boolean(request.base64) && existing.base64 === request.base64;
    if (same) return stageDocumentAsset(request);
    const choice = window.prompt(
      `ファイルがすでに存在します: ${request.preferredSource}\n\n1: 上書きする\n2: 中止する\n3: 別の名前で作成する`,
      "1",
    );
    if (choice === "2" || choice === null) return null;
    if (choice === "3") return stageDocumentAsset({ ...request, preferredSource: undefined });
    if (choice !== "1") return null;
    return stageDocumentAsset(request);
  }, []);
  const [annotationTarget, setAnnotationTarget] = useState<ImageEditTarget | null>(null);
  const [annotationReturnPreview, setAnnotationReturnPreview] = useState<MediaPreviewTarget | null>(null);
  const [svgEditorTarget, setSvgEditorTarget] = useState<SvgSourceEditTarget | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [editingTestReportOpen, setEditingTestReportOpen] = useState(false);
  const [documentPanels, setDocumentPanels] = useState<Record<string, Exclude<DocumentSidePanelTab, "search"> | null>>({});
  const documentPanelsRef = useRef(documentPanels);
  const panelBeforeSearchRef = useRef<Record<string, Exclude<DocumentSidePanelTab, "search"> | null>>({});
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [diagnosticWatchTargets, setDiagnosticWatchTargets] = useState<Record<string, string[]>>({});
  const [diagnosticsRefresh, setDiagnosticsRefresh] = useState(0);
  const [activeTocHeadingId, setActiveTocHeadingId] = useState<string | null>(null);
  const [activeImageOccurrenceId, setActiveImageOccurrenceId] = useState<string | null>(null);
  const [focusedLinkTarget, setFocusedLinkTarget] = useState<string | null>(null);
  const [activeEditorLine, setActiveEditorLine] = useState<number | null>(null);
  const [previewContext, setPreviewContext] = useState<PreviewContextState | null>(null);
  const tocPointerFrame = useRef(0);
  const pendingTocHeadingId = useRef<string | null>(null);
  const mediaPreviewRef = useRef<MediaPreviewTarget | null>(null);
  const mediaPreviewViewRef = useRef<MediaPreviewViewState | null>(null);
  const navigationHistoryRef = useRef(emptyNavigationHistory());
  const auxiliaryNavigationRef = useRef<AuxiliaryNavigationStamp>({ button: -1, timestamp: 0 });
  const viewModeRef = useRef(viewMode);
  const documentViewModesRef = useRef(documentViewModes);
  const windowLabel = getCurrentWindow().label;
  documentPanelsRef.current = documentPanels;
  documentViewModesRef.current = documentViewModes;

  useEffect(() => subscribeMermaidStatus(setMermaidStatus), []);

  useEffect(() => {
    const handleMarkdownToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; type?: ToastState["type"]; actionLabel?: string; onAction?: ToastState["onAction"]; actions?: ToastState["actions"]; onMessageClick?: ToastState["onMessageClick"] }>).detail;
      if (!detail?.message) return;
      setToast({ id: String(Date.now()), message: detail.message, type: detail.type ?? "info", actionLabel: detail.actionLabel, onAction: detail.onAction, actions: detail.actions, onMessageClick: detail.onMessageClick });
    };
    window.addEventListener("markdown-toast", handleMarkdownToast);
    return () => window.removeEventListener("markdown-toast", handleMarkdownToast);
  }, []);
  const [contextTab, setContextTab] = useState<{ id: string; x: number; y: number } | null>(null);
  const [closedTabs, setClosedTabs] = useState<ClosedTabState[]>([]);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("preview");
  const [splitDirection, setSplitDirection] = useState<SplitDirection>("auto");
  const visualEditing = previewMode === "visual";
  const [tabsState, reactDispatch] = useReducer(tabsReducer, initialTabsState);
  const tabsStateRef = useRef(tabsState);
  tabsStateRef.current = tabsState;
  const dispatch = useCallback((action: TabsAction) => {
    // 同一イベント内の通知・保存完了も最新stateに対して世代を取得する。
    tabsStateRef.current = tabsReducer(tabsStateRef.current, action);
    reactDispatch(action);
  }, []);
  const autoReloadRef = useRef(autoReload);
  autoReloadRef.current = autoReload;
  const refreshTabStorage = useMemo(() => createDocumentStorageRefresh({
    getTab: (id) => tabsStateRef.current.tabs.find((tab) => tab.id === id),
    load: loadMarkdown, dispatch, shouldReload: (id) => (autoReloadRef.current === "on" || Boolean(tabsStateRef.current.tabs.find((tab) => tab.id === id)?.deleted))
      && !documentDiffProtectsDraft(tabsStateRef.current.tabs.find((tab) => tab.id === id), diffReviewRef.current),
  }), []);
  useEffect(() => startDeletedDocumentRecovery(
    () => tabsStateRef.current.tabs.map((tab) => ({ ...tab, local: Boolean(tab.document && !isSharePointDocument(tab.document)) })),
    (id) => refreshTabStorage(id),
  ), [refreshTabStorage]);
  const resolvePastedImage = useCallback(async (image: ClipboardImageData): Promise<ResolvedClipboardImage> => {
    const embedded = { source: `data:${image.mediaType};base64,${image.base64}` };
    if (clipboardImage.storage === "base64") return embedded;
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabsStateRef.current.activeId);
    if (!tab?.document || tab.untitled || isSharePointDocument(tab.document)) {
      setToast({ id: crypto.randomUUID(), message: "保存先が未確定のため、画像をBase64で埋め込みました。", type: "info" });
      return embedded;
    }
    const staged = await stageClipboardImage({
      documentPath: tab.document.path,
      preferredFilename: clipboardImage.pngLocation === "fixed" ? clipboardImage.fixedFilename : formatClipboardImageFilename(new Date()),
      base64: image.base64,
      ...clipboardImageDestination(clipboardImage.pngLocation, clipboardImage.absoluteDirectory),
    });
    return {
      source: staged.filename,
      asset: {
        ...staged,
        previewSource: `data:${staged.mediaType ?? "image/png"};base64,${staged.base64}`,
      },
    };
  }, [clipboardImage, setToast]);
  mediaPreviewRef.current = mediaPreview;
  const [imageVersions, setImageVersions] = useState<Record<string, number>>({});
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeId) ?? null;
  useEffect(() => { storageConversionPromptedRef.current.clear(); }, [activeTab?.id, activeTab?.path]);
  const activeSharePoint = isSharePointDocument(activeTab?.document ?? activeTab);
  const canEditActive = canEditMarkdownDocument(activeTab?.document);
  const editorMode: EditorWorkspaceMode = canEditActive ? activeTab?.editorMode ?? "preview" : "preview";

  useEffect(() => {
    if (!focusNewDocumentRef.current || !activeTab?.untitled || editorMode === "preview") return;
    let frame = 0;
    let attempts = 0;
    const focusEditor = () => {
      if (!focusNewDocumentRef.current) return;
      if (tabsStateRef.current.activeId !== activeTab.id) { focusNewDocumentRef.current = false; return; }
      if (editorRef.current) {
        editorRef.current.focus();
        focusNewDocumentRef.current = false;
        return;
      }
      // MarkdownEditor is lazy-loaded; keep polling for roughly one second so
      // the first focus is not lost while its chunk is being mounted.
      if (attempts++ < 60) frame = window.requestAnimationFrame(focusEditor);
    };
    frame = window.requestAnimationFrame(focusEditor);
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab?.id, activeTab?.untitled, editorMode]);
  const activeMarkdownContent = activeTab?.document?.kind === "markdown" ? activeTab.draft : activeTab?.document?.content ?? "";
  const previewContent = useDeferredValue(activeMarkdownContent);

  useEffect(() => {
    void getCurrentWindow().setTitle(applicationWindowTitle(activeTab)).catch(() => {
      // Browser and unit-test hosts do not provide the Tauri window API.
    });
  }, [activeTab?.id, activeTab?.kind, activeTab?.path]);

  useEffect(() => {
    if (import.meta.env.VITE_MDVISUALIZER_DEBUG_API !== "1") return;
    void reportDebugWindowState(buildDebugWindowState(windowLabel, tabsState, mediaPreview !== null));
  }, [mediaPreview, tabsState, windowLabel]);

  useEffect(() => {
    const hasUnsavedChanges = () => tabsStateRef.current.tabs.some((tab) => tab.dirty);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const appWindow = getCurrentWindow();
    void appWindow.onCloseRequested((event) => {
      void handleWindowCloseRequest(
        hasUnsavedChanges(),
        (message) => window.confirm(message),
        event,
        () => appWindow.destroy(),
      );
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch(() => {
      // Browser and unit-test hosts do not provide the Tauri window event API.
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
    if (!activeTab?.document || activeSharePoint || viewMode === "presentation") return [];
    return groupImageOccurrences(collectImageOccurrences(previewContent, activeTab.document.base_dir));
  }, [activeSharePoint, activeTab?.document, previewContent, viewMode]);
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
    setActiveEditorLine(null);
    setPreviewContext(null);
  }, [activeTab?.id]);

  useLayoutEffect(() => {
    const root = markdownRef.current;
    root?.querySelectorAll(".is-editor-current-line").forEach((element) => element.classList.remove("is-editor-current-line"));
    if (!root || editorMode !== "split" || activeEditorLine === null) return;
    const blocks = previewSourceBlocks(root, true);
    const index = sourceBlockIndexForLine(blocks.map((block) => Number(block.dataset.sourceLine)), activeEditorLine);
    const target = blocks[index];
    target?.classList.add("is-editor-current-line");
    return () => target?.classList.remove("is-editor-current-line");
  }, [activeEditorLine, activeTab?.generation, editorMode, previewContent]);

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
  const search = useSearch(markdownRef, `${windowLabel}-${tabsState.activeId ?? "empty"}`, updateSearchExpandedIds, searchRefreshKey, previewContent);
  const { cropTarget, startCrop, cancelCrop } = useCropEditor();
  useEffect(() => {
    if (!activeTab?.document || activeTab.untitled || activeSharePoint) { setDiagnostics([]); return; }
    let disposed = false;
    void diagnoseDocument(activeTab.document.path).then((items) => { if (!disposed) setDiagnostics(items); }).catch((error) => {
      if (!disposed) setDiagnostics([{ severity: "warning", kind: "診断", line: 1, reference: activeTab.document!.path, message: `診断を完了できません: ${String(error)}` }]);
    });
    return () => { disposed = true; };
  }, [activeSharePoint, activeTab?.document?.path, activeTab?.generation, activeTab?.untitled, diagnosticsRefresh]);
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
      const current = tabsStateRef.current.tabs.find((tab) => tab.id === id);
      const discardedAssets = current?.generation === generation && !current.saving
        && (current.changeSequence ?? 0) === (current.reloadSequence ?? 0) ? current.pendingAssets ?? [] : [];
      dispatch({ type: "LOADED", id, generation, document });
      if (discardedAssets.length) void discardStagedAssets(discardedAssets.map((asset) => asset.id));
    } catch (error) {
      dispatch({ type: "FAILED", id, generation, error: String(error) });
    } finally {
      if (path.toLowerCase().startsWith("spmd://")) dismissAuthentication();
      inFlightLoads.current.delete(loadKey);
    }
  }, [dismissAuthentication]);

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
    [...new Set(tabsState.tabs.flatMap((tab) => tab.document && !tab.untitled && !isSharePointDocument(tab.document)
      ? [...(diagnosticWatchTargets[tab.document.path] ?? [tab.document.path]), ...tab.document.image_paths]
      : []))].sort(),
  );

  const watchableDocumentsKey = JSON.stringify(tabsState.tabs.flatMap((tab) => tab.document && !tab.untitled && !isSharePointDocument(tab.document) ? [tab.document.path, tab.document.revision] : []));
  useEffect(() => {
    let disposed = false;
    const paths = tabsState.tabs.flatMap((tab) => tab.document && !tab.untitled && !isSharePointDocument(tab.document) ? [tab.document.path] : []);
    void Promise.all(paths.map(async (path) => [path, await documentWatchTargets(path)] as const)).then((entries) => {
      if (!disposed) setDiagnosticWatchTargets(Object.fromEntries(entries));
    }).catch(() => {
      // The normal image_paths watcher remains active when diagnostics cannot load.
    });
    return () => { disposed = true; };
  }, [watchableDocumentsKey]);

  useEffect(() => {
    // OFFは通常本文の自動更新を止める。開いているDiffの最新版監視は独立して維持する。
    const targets: string[] = autoReload === "off" ? (documentDiff ? [documentDiff.path] : []) : JSON.parse(watchTargetKey);
    if (targets.length > 0) void syncWatchTargets(windowLabel, targets);
    else void removeWindowWatchTargets(windowLabel);
  }, [watchTargetKey, autoReload, windowLabel, documentDiff?.path]);

  useEffect(() => () => { void removeWindowWatchTargets(windowLabel); }, [windowLabel]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listenForSecondaryLaunches((event) => {
      for (const path of event.payload) {
        void openInNewWindow(path).catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
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

  const reloadTab = useCallback((id: string, confirmDiscard = true) => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === id);
    if (!tab) return false;
    if (confirmDiscard && tab.dirty && !window.confirm(`${tab.path}\n\n未保存の編集内容を破棄して再読み込みしますか？`)) return false;
    if (id === tabsStateRef.current.activeId && containerRef.current && markdownRef.current) {
      const anchor = captureScrollAnchor(containerRef.current, markdownRef.current);
      if (anchor) reloadAnchors.current[id] = anchor;
    }
    dispatch({ type: "RELOAD", id });
    return true;
  }, []);

  const reload = useCallback(() => {
    if (activeTab?.document && !activeTab.untitled) reloadTab(activeTab.id);
  }, [activeTab, reloadTab]);

  const openDocument = useCallback(async () => {
    try {
    const selected = await showOpenDialog({
      title: "ファイルを開く",
      multiple: true,
      filters: [{ name: "対応ファイル", extensions: ["md", "markdown", "tsv", "csv", "svg", "mmd", "mermaid", "drawio"] }],
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    paths.forEach((path) => dispatch({ type: "OPEN", path }));
    } catch (error) {
      setToast({ id: crypto.randomUUID(), message: `ファイルを開けませんでした: ${String(error)}`, type: "error" });
    }
  }, []);

  const toggleDocumentDiff = useCallback(() => {
    if (documentDiff) {
      setDocumentDiff(null);
      return;
    }
    const tabId = tabsStateRef.current.activeId;
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabId);
    if (!tab?.document || tab.document.kind !== "markdown") return;
    setDocumentDiff(documentDiffTarget(tab));
    void refreshTabStorage(tab.id, false);
  }, [documentDiff, refreshTabStorage]);

  useEffect(() => { setDocumentDiff(null); }, [activeTab?.id]);

  const saveTab = useCallback(async (id: string) => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === id);
    const draft = tab?.draft;
    if (!tab?.document || draft === undefined || tab.saving) return;
    const permission = documentDiffSavePermission(tab, diffReviewRef.current);
    if (permission.error) {
      setToast({ id: crypto.randomUUID(), message: permission.error, type: "error" });
      return;
    }
    if (!tab.dirty && !permission.force) return;
    if (!canEditMarkdownDocument(tab.document)) {
      setToast({ id: String(Date.now()), message: "この文書は閲覧専用です。", type: "error" });
      return;
    }
    dispatch({ type: "SAVE_STARTED", id, force: permission.force });
    let identity = !tab.untitled && !isSharePointDocument(tab.document) ? localPathIdentity(tab.document.path) : null;
    const selfSaveUntil = Date.now() + 2000;
    const markSelfSave = (nextIdentity: string | null) => {
      if (!nextIdentity) return;
      const key = nextIdentity;
      identity = key;
      recentSelfSaves.current.set(key, selfSaveUntil);
      window.setTimeout(() => {
        if (recentSelfSaves.current.get(key) === selfSaveUntil) recentSelfSaves.current.delete(key);
      }, 2100);
    };
    markSelfSave(identity);
    try {
      const stagedAssetIds = referencedStagedAssetIds(draft, tab.document.base_dir, tab.pendingAssets ?? []);
      let document;
      if (tab.untitled) {
        const result = await saveUntitledDocument({
          defaultPath: tab.path,
          content: draft,
          openDocumentPaths: tabsStateRef.current.tabs.flatMap((candidate) => candidate.id !== id && !candidate.untitled
            ? [candidate.document?.path ?? candidate.path]
            : []),
        }, {
          choosePath: (defaultPath) => showSaveDialog({
            title: "Markdownに名前を付けて保存",
            defaultPath,
            filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
          }),
          createDocument: (path, content) => createMarkdown({ path, content }),
        });
        if (result.status === "cancelled") {
          dispatch({ type: "SAVE_CANCELLED", id });
          return;
        }
        markSelfSave(localPathIdentity(result.path));
        document = result.document;
      } else {
        const result = await saveMarkdown({
          path: tab.document.path,
          content: draft,
          expectedRevision: permission.expectedRevision,
          stagedAssetIds,
        });
        if (result.status === "conflict") {
          if (identity) recentSelfSaves.current.delete(identity);
          const latestTab = tabsStateRef.current.tabs.find((candidate) => candidate.id === id) ?? tab;
          dispatch({ type: "SAVE_FAILED", id, error: "保存先が更新されています。差分を確認してください。" });
          dispatch({ type: "EXTERNAL_CHANGED", id, changed: true });
          dispatch({ type: "STORAGE_CONFLICT", id, document: result.latest });
          if (tabsStateRef.current.activeId === id) setDocumentDiff({
            path: result.latest.path,
            baseDir: result.latest.base_dir,
            openedContent: latestTab.openedContent ?? tab.document.content,
            storageContent: result.latest.content,
            editingContent: draft,
            storageRevision: result.latest.revision,
            conflict: true,
          });
          setToast({ id: String(Date.now()), message: "保存先が更新されています。DIFFで確認してから上書きしてください。", type: "error" });
          return;
        }
        document = result.document;
      }
      dispatch({ type: "SAVED", id, document, committedAssetIds: stagedAssetIds });
      // A successful save establishes a new Diff baseline, but an already
      // open Diff workspace remains visible so the user can continue editing
      // and see any changes made while the save was in flight.
      setDocumentDiff((current) => current && localPathIdentity(current.path) === localPathIdentity(document.path) ? {
        ...current,
        openedContent: document.content,
        storageContent: document.content,
        storageRevision: document.revision,
        conflict: false,
      } : current);
      setToast({ id: String(Date.now()), message: `${document.path} を保存しました`, type: "success" });
      // 保存完了と外部通知の順序が逆転しても、保存後の最新版を再確認する。
      queueMicrotask(() => { void refreshTabStorage(id, false); });
    } catch (error) {
      if (identity) recentSelfSaves.current.delete(identity);
      const message = String(error);
      dispatch({ type: "SAVE_FAILED", id, error: message });
      if (message.toLowerCase().includes("conflict") || message.includes("更新されています") || message.includes("HTTP 412")) dispatch({ type: "EXTERNAL_CHANGED", id, changed: true });
      setToast({ id: String(Date.now()), message: `保存に失敗しました: ${message}`, type: "error" });
    }
  }, [refreshTabStorage]);

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
      editorMode: tab?.kind === "document" ? tab.editorMode : null,
      editorLine: editorRef.current?.topLine() ?? null,
      scrollAnchor: containerRef.current && markdownRef.current ? captureScrollAnchor(containerRef.current, markdownRef.current) : null,
      mediaPreview: mediaPreviewRef.current,
      mediaView: mediaPreviewViewRef.current,
    };
  }, []);

  const recordNavigationPoint = useCallback(() => {
    navigationHistoryRef.current = recordNavigation(navigationHistoryRef.current, captureNavigationSnapshot());
  }, [captureNavigationSnapshot]);

  const navigateToSourceLine = useCallback((line: number, options: { headingId?: string; blockId?: string; targetElement?: HTMLElement; closePanel?: boolean; block?: ScrollLogicalPosition } = {}): boolean => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabsStateRef.current.activeId);
    const root = markdownRef.current;
    if (!tab?.document || !root || !Number.isFinite(line) || line < 1) return false;
    const findTarget = () => {
      if (options.targetElement && root.contains(options.targetElement)) return options.targetElement;
      if (options.blockId) {
        const exact = [...root.querySelectorAll<HTMLElement>("[data-block-id]")]
          .find((candidate) => candidate.dataset.blockId === options.blockId);
        if (exact) return exact;
      }
      if (options.headingId) {
        const heading = [...root.querySelectorAll<HTMLElement>("[data-fold-id]")]
          .find((candidate) => candidate.dataset.foldId === options.headingId);
        if (heading) return heading;
      }
      const blocks = [...root.querySelectorAll<HTMLElement>("[data-source-line]")]
        .map((element) => ({ block: element, line: Number(element.dataset.sourceLine) }))
        .filter((entry) => Number.isFinite(entry.line))
        .sort((left, right) => left.line - right.line);
      return nearestRenderedSourceBlock(blocks, line)?.block ?? null;
    };
    if (!sourceAnchorForLine(root, line)) return false;
    const initialTarget = findTarget();
    if (!initialTarget) return false;
    recordNavigationPoint();
    const foldIds = foldIdsForElement(initialTarget);
    if (foldIds.length > 0) {
      setFoldStates((current) => {
        const currentForPath = current[tab.path] ?? {};
        const nextForPath = { ...currentForPath };
        let changed = false;
        for (const foldId of foldIds) {
          if (nextForPath[foldId]) {
            nextForPath[foldId] = false;
            changed = true;
          }
        }
        if (!changed) return current;
        void saveFoldState(tab.path, nextForPath).catch((error) => setToast({
          id: String(Date.now()),
          message: `折りたたみ状態の保存に失敗しました: ${String(error)}`,
          type: "error",
        }));
        return { ...current, [tab.path]: nextForPath };
      });
      setActiveTocHeadingId(foldIds[0]);
    }
    if (options.closePanel && (typeof window.matchMedia !== "function" || !window.matchMedia("(min-width: 860px)").matches)) {
      setDocumentPanels((current) => ({ ...current, [tab.id]: null }));
    }
    const scroll = () => {
      const target = findTarget();
      if (!target) return;
      target.classList.add("source-navigation-target");
      window.setTimeout(() => target.classList.remove("source-navigation-target"), 1400);
      target.scrollIntoView({ block: options.block ?? "center", behavior: "auto" });
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
    return true;
  }, [recordNavigationPoint, setFoldStates]);

  const jumpToImageOccurrence = useCallback((occurrenceId: string) => {
    const target = document.getElementById(occurrenceId);
    if (!target || !activeTab?.document) return;
    setActiveImageOccurrenceId(occurrenceId);
    const line = Number(target.getAttribute("data-source-line"));
    if (Number.isFinite(line) && navigateToSourceLine(line, { targetElement: target, closePanel: true })) return;
    recordNavigationPoint();
    target.classList.add("source-navigation-target");
    window.setTimeout(() => target.classList.remove("source-navigation-target"), 1400);
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: "center" })));
  }, [activeTab?.document, navigateToSourceLine, recordNavigationPoint]);

  const jumpToDocumentHeading = useCallback((headingId: string) => {
    const section = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-fold-id]") ?? [])]
      .find((candidate) => candidate.dataset.foldId === headingId);
    if (!section || !activeTab?.document) return;
    const line = Number(section.querySelector<HTMLElement>("[data-source-line]")?.dataset.sourceLine ?? section.dataset.sourceLine);
    navigateToSourceLine(line, { headingId, closePanel: true, block: "start" });
  }, [activeTab?.document, activeTab?.id, navigateToSourceLine]);

  const jumpToTocHeading = useCallback((headingId: string) => {
    if (viewModeRef.current !== "presentation") {
      jumpToDocumentHeading(headingId);
      return;
    }
    if (!activeTab?.document) return;
    recordNavigationPoint();
    presentationPositionsRef.current[activeTab.id] = headingId;
    setPresentationPositions((current) => current[activeTab.id] === headingId
      ? current
      : { ...current, [activeTab.id]: headingId });
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(min-width: 860px)").matches) {
      setDocumentPanels((current) => ({ ...current, [activeTab.id]: null }));
    }
  }, [activeTab?.document, activeTab?.id, jumpToDocumentHeading, recordNavigationPoint]);

  const moveTocHeading = useCallback((sourceHeadingId: string, targetHeadingId: string, position: "before" | "after"): boolean => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabsStateRef.current.activeId);
    if (!tab?.document || tab.document.kind !== "markdown") return false;
    const model = buildPresentationModel(tab.draft);
    const sourceHeading = model.headings[sourceHeadingId];
    const targetHeading = model.headings[targetHeadingId];
    if (!sourceHeading || !targetHeading) return false;
    const content = moveHeadingBlock(tab.draft, sourceHeading.headingStart, targetHeading.headingStart, position);
    if (!content || content === tab.draft) return false;
    dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
    setActiveTocHeadingId(null);
    setFoldStates((current) => ({ ...current, [tab.path]: {} }));
    void saveFoldState(tab.path, {}).catch((error) => setToast({
      id: String(Date.now()),
      message: `折りたたみ状態の同期に失敗しました: ${String(error)}`,
      type: "error",
    }));
    return true;
  }, []);

  const saveStandaloneDrawio = useCallback(async (id: string, content: string): Promise<boolean> => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === id);
    if (!tab?.document || tab.document.kind !== "drawio") return false;
    const identity = localPathIdentity(tab.document.path);
    const selfSaveUntil = Date.now() + 2000;
    recentSelfSaves.current.set(identity, selfSaveUntil);
    window.setTimeout(() => {
      if (recentSelfSaves.current.get(identity) === selfSaveUntil) recentSelfSaves.current.delete(identity);
    }, 2100);
    try {
      const result = await saveMarkdown({
        path: tab.document.path,
        content,
        expectedRevision: tab.document.revision,
        stagedAssetIds: [],
      });
      if (result.status === "conflict") {
        recentSelfSaves.current.delete(identity);
        dispatch({ type: "EXTERNAL_CHANGED", id, changed: true });
        throw new Error("保存先のdraw.ioファイルが更新されています。再読込してから編集してください。");
      }
      dispatch({ type: "SAVED", id, document: result.document });
      setToast({ id: String(Date.now()), message: `${result.document.path} を保存しました`, type: "success" });
      return true;
    } catch (error) {
      recentSelfSaves.current.delete(identity);
      setToast({ id: String(Date.now()), message: `draw.ioの保存に失敗しました: ${String(error)}`, type: "error" });
      throw error;
    }
  }, []);

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
      setPresentationSearchLines((current) => ({ ...current, [activeTab.id]: result.line }));
      return;
    }
    if (navigateToSourceLine(result.line, { closePanel: false })) return;
    if (result.headingId) jumpToDocumentHeading(result.headingId);
  }, [activeTab, jumpToDocumentHeading, navigateToSourceLine, recordNavigationPoint, search]);

  const jumpToDiagnostic = useCallback((item: DiagnosticItem) => {
    if (!activeTab?.document) return;
    navigateToSourceLine(item.line, { closePanel: false });
  }, [activeTab?.document, navigateToSourceLine]);

  const releasePaneSync = useCallback(() => {
    if (paneSyncFrame.current) window.cancelAnimationFrame(paneSyncFrame.current);
    paneSyncFrame.current = window.requestAnimationFrame(() => {
      paneSyncFrame.current = 0;
      paneSyncOrigin.current = null;
    });
  }, []);

  const handleEditorScrollLine = useCallback((line: number) => {
    if (paneSyncOrigin.current === "view") return;
    const container = containerRef.current;
    const blocks = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-source-line]") ?? [])]
      .filter((block) => block.getClientRects().length > 0);
    if (!container || blocks.length === 0) return;
    const containerBounds = container.getBoundingClientRect();
    const targetTop = sourceTopForLine(blocks.map((block) => ({
      line: Number(block.dataset.sourceLine) || 1,
      top: block.getBoundingClientRect().top,
    })), line);
    if (targetTop === null) return;
    const viewportScale = container.clientHeight > 0 ? containerBounds.height / container.clientHeight : 1;
    paneSyncOrigin.current = "edit";
    const previousScrollTop = container.scrollTop;
    container.scrollTop += scrollDeltaForViewportAnchor(targetTop, containerBounds.top, container.clientHeight / 2, viewportScale);
    if (Math.abs(container.scrollTop - previousScrollTop) > 0.5) pendingPreviewScrollTop.current = { value: container.scrollTop, until: performance.now() + 200 };
    releasePaneSync();
  }, [releasePaneSync]);

  const handleEditorCursorPosition = useCallback((position: EditorCursorPosition) => {
    if (paneSyncOrigin.current === "view") return;
    const container = containerRef.current;
    const blocks = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-source-line]") ?? [])]
      .filter((block) => block.getClientRects().length > 0);
    if (!container || blocks.length === 0) return;
    const containerBounds = container.getBoundingClientRect();
    const targetTop = sourceTopForLine(blocks.map((block) => ({
      line: Number(block.dataset.sourceLine) || 1,
      top: block.getBoundingClientRect().top,
    })), position.line);
    if (targetTop === null) return;
    const viewportScale = container.clientHeight > 0 ? containerBounds.height / container.clientHeight : 1;
    paneSyncOrigin.current = "edit";
    const previousScrollTop = container.scrollTop;
    const endScrollTop = synchronizedPaneEndScrollTop(
      position,
      blocks.reduce((lastLine, block) => Math.max(lastLine, Number(block.dataset.sourceLine) || 1), 1),
      container,
    );
    if (endScrollTop === null) {
      container.scrollTop += scrollDeltaForViewportAnchor(targetTop, containerBounds.top, container.clientHeight / 2, viewportScale);
    } else {
      container.scrollTop = endScrollTop;
    }
    if (Math.abs(container.scrollTop - previousScrollTop) > 0.5) pendingPreviewScrollTop.current = { value: container.scrollTop, until: performance.now() + 200 };
    releasePaneSync();
  }, [releasePaneSync]);

  const handlePreviewScroll = useCallback((element: HTMLElement) => {
    if (activeTab) dispatch({ type: "SCROLL", id: activeTab.id, scrollTop: element.scrollTop });
    const pending = pendingPreviewScrollTop.current;
    if (pending !== null) {
      pendingPreviewScrollTop.current = null;
      if (performance.now() <= pending.until && Math.abs(element.scrollTop - pending.value) <= 0.5) return;
    }
    if (viewModeRef.current === "presentation") return;
    if (editorMode !== "split" || paneSyncOrigin.current === "edit") return;
    const blocks = [...(markdownRef.current?.querySelectorAll<HTMLElement>("[data-source-line]") ?? [])]
      .filter((block) => block.getClientRects().length > 0);
    const line = sourceLineAtViewportTop(blocks.map((block) => ({
      line: Number(block.dataset.sourceLine) || 1,
      top: block.getBoundingClientRect().top,
    })), element.getBoundingClientRect().top + element.clientHeight / 2);
    paneSyncOrigin.current = "view";
    editorRef.current?.scrollToLine(line);
    releasePaneSync();
  }, [activeTab?.id, editorMode, releasePaneSync]);

  const handlePreviewClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!canEditActive || viewModeRef.current === "presentation") return;
    if (hasPreviewTextSelection(window.getSelection(), markdownRef.current)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("a, button, input, textarea, select")) return;
    const block = target.closest<HTMLElement>("[data-source-line]");
    const line = Number(block?.dataset.sourceLine);
    if (!Number.isFinite(line) || line < 1) return;
    if (editorMode === "preview") return;
    paneSyncOrigin.current = "view";
    editorRef.current?.focusLine(line);
    releasePaneSync();
  }, [canEditActive, editorMode, releasePaneSync]);

  const handlePreviewContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const targetElement = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
    if (targetElement?.closest(".table-editor-overlay")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!activeTab?.document || activeTab.document.kind !== "markdown" || viewModeRef.current === "presentation") return;
    const root = markdownRef.current;
    const target = event.target instanceof Node ? event.target : null;
    if (!root || !target) return;
    event.preventDefault();
    const blocks = previewSourceBlocks(root);
    const sourceLines = blocks.map((block) => Number(block.dataset.sourceLine));
    const clickedLine = previewSourceLineAtNode(target, root) ?? sourceLines[0] ?? 1;

    const rowElement = targetElement?.closest<HTMLTableRowElement>("tr") ?? null;
    const tableRow = rowElement && root.contains(rowElement) ? rowElement : null;
    setPreviewContext({
      x: event.clientX,
      y: event.clientY,
      line: clickedLine,
      ...previewClipboardData(root, previewContent, targetElement),
      rowElement: tableRow,
      rowTsv: tableRow ? [...tableRow.querySelectorAll("th, td")].map((cell) => cell.textContent?.trim() ?? "").join("\t") : "",
    });
  }, [activeTab?.document, previewContent]);

  const editPreviewContextLine = useCallback(() => {
    if (!previewContext || !activeTab || !canEditActive) return;
    const line = previewContext.line;
    setPreviewContext(null);
    if (editorMode === "preview") {
      pendingEditorLine.current = line;
      dispatch({ type: "EDITOR_MODE", id: activeTab.id, mode: "split" });
    } else {
      editorRef.current?.focusLine(line);
    }
  }, [activeTab?.id, canEditActive, editorMode, previewContext]);

  const selectPreviewContent = useCallback((line?: number) => {
    const root = markdownRef.current;
    if (!root) return;
    const target = line === undefined
      ? root
      : previewSourceBlocks(root).find((block) => Number(block.dataset.sourceLine) === line);
    if (!target) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const selectPreviewRow = useCallback(() => {
    const row = previewContext?.rowElement;
    if (!row || !row.isConnected) return;
    const range = document.createRange();
    range.selectNodeContents(row);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [previewContext]);

  useEffect(() => {
    if (editorMode === "preview" || pendingEditorLine.current === null) return;
    const line = pendingEditorLine.current;
    pendingEditorLine.current = null;
    const frame = window.requestAnimationFrame(() => editorRef.current?.focusLine(line));
    return () => window.cancelAnimationFrame(frame);
  }, [editorMode]);

  useEffect(() => () => {
    if (paneSyncFrame.current) window.cancelAnimationFrame(paneSyncFrame.current);
  }, []);

  const handlePreviewPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (viewModeRef.current === "presentation") return;
    const target = event.target instanceof Element ? event.target : null;
    pendingTocHeadingId.current = tocHeadingIdAtPointer(target, markdownRef.current);
    if (tocPointerFrame.current) return;
    tocPointerFrame.current = window.requestAnimationFrame(() => {
      tocPointerFrame.current = 0;
      const pending = pendingTocHeadingId.current;
      setActiveTocHeadingId((previous) => previous === pending ? previous : pending);
    });
  }, []);

  const handlePreviewPointerLeave = useCallback(() => {
    if (viewModeRef.current === "presentation") return;
    // Keep the last confirmed heading lit while the pointer is outside the
    // document. It is cleared only by a new pointer position or tab change.
  }, []);

  useEffect(() => () => { if (tocPointerFrame.current) window.cancelAnimationFrame(tocPointerFrame.current); }, []);

  const restoreNavigationSnapshot = useCallback((snapshot: NavigationSnapshot) => {
    let restoresExistingTab = false;
    if (snapshot.activeTabId && tabsStateRef.current.tabs.some((tab) => tab.id === snapshot.activeTabId)) {
      restoresExistingTab = true;
      dispatch({ type: "SCROLL", id: snapshot.activeTabId, scrollTop: snapshot.scrollTop });
      if (snapshot.editorMode) dispatch({ type: "EDITOR_MODE", id: snapshot.activeTabId, mode: snapshot.editorMode });
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
    mediaPreviewViewRef.current = snapshot.mediaView;
    mediaPreviewRef.current = snapshot.mediaPreview;
    setMediaPreviewInitialViewState(snapshot.mediaView);
    setMediaPreview(snapshot.mediaPreview);
    if (restoresExistingTab && snapshot.activeTabId) {
      const tabId = snapshot.activeTabId;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (tabsStateRef.current.activeId !== tabId) return;
        if (snapshot.scrollAnchor && containerRef.current && markdownRef.current) {
          restoreScrollAnchor(containerRef.current, markdownRef.current, snapshot.scrollAnchor);
        } else if (containerRef.current) {
          containerRef.current.scrollTop = snapshot.scrollTop;
        }
        if (snapshot.editorLine !== null) editorRef.current?.scrollToLine(snapshot.editorLine);
      }));
    }
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
    const identity = documentSourceIdentity(path);
    const existing = tabsStateRef.current.tabs.find((tab) => tab.kind !== "settings" && documentSourceIdentity(tab.path) === identity);
    if (existing?.id === tabsStateRef.current.activeId) return;
    recordNavigationPoint();
    dispatch({ type: "OPEN", path });
  }, [recordNavigationPoint]);
  const handleOpenDocumentWindow = useCallback((path: string) => {
    void openInNewWindow(path).catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
  }, []);
  useFileDrop((paths) => paths.forEach(handleOpenDocument));

  const openMediaPreview = useCallback((target: MediaPreviewTarget) => {
    recordNavigationPoint();
    mediaPreviewViewRef.current = null;
    setMediaPreviewInitialViewState(null);
    mediaPreviewRef.current = target;
    setMediaPreview(target);
  }, [recordNavigationPoint]);

  const closeMediaPreview = useCallback(() => {
    if (!mediaPreviewRef.current) return;
    recordNavigationPoint();
    setMediaPreview(null);
    mediaPreviewRef.current = null;
    mediaPreviewViewRef.current = null;
    setMediaPreviewInitialViewState(null);
  }, [recordNavigationPoint]);

  const handleMediaPreviewViewState = useCallback((state: MediaPreviewViewState) => {
    mediaPreviewViewRef.current = state;
  }, []);

  const saveImageCaption = useCallback(async (context: ImageEditContext, caption: string) => {
    if (tabsStateRef.current.tabs.some((tab) => localPathIdentity(tab.path) === localPathIdentity(context.markdownPath) && tab.dirty)) {
      throw new Error("未保存のMarkdown編集があります。先に文書を保存してから画像情報を変更してください。");
    }
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
      headingTitle: caption.trim() || undefined,
      imageContext: { ...current.imageContext, caption },
    } : current);
    setToast({ id: String(Date.now()), message: "キャプションを保存しました", type: "success" });
  }, []);

  const renameExternalFile = useCallback(async (context: ExternalFileRenameContext, filename: string) => {
    let nextFilename = filename;
    let overwrite = false;
    const targetSource = context.source.replace(/[^/\\]+$/, filename);
    try {
      const [current, target] = await Promise.all([
        readDocumentAsset(context.documentPath, context.source),
        readDocumentAsset(context.documentPath, targetSource),
      ]);
      if (current.base64 === target.base64) {
        overwrite = true;
        setToast({ id: crypto.randomUUID(), message: "内容が同一のため、既存ファイルへ統合します。", type: "info" });
      } else {
        const choice = window.prompt(`ファイルがすでに存在します: ${targetSource}\n\n1: 上書きする\n2: 中止する\n3: 別の名前で作成する`, "1");
        if (choice === "2" || choice === null) return false;
        if (choice === "3") {
          const alternative = window.prompt("別のファイル名を入力してください", filename);
          if (!alternative?.trim()) return false;
          nextFilename = alternative.trim();
        } else if (choice !== "1") return false;
        overwrite = true;
      }
    } catch {
      // The target does not exist; the normal rename path performs validation.
    }
    const result = await renameImageAndReferences({
      markdownPath: context.documentPath,
      imagePath: context.filePath,
      newFilename: nextFilename,
      overwrite,
    });
    const changed = new Set(result.updatedDocuments.map(localPathIdentity));
    await Promise.all(tabsStateRef.current.tabs
      .filter((tab) => changed.has(localPathIdentity(tab.path)) && tab.document)
      .map(async (tab) => {
        const latest = await loadMarkdown(tab.path);
        const current = tabsStateRef.current.tabs.find((candidate) => candidate.id === tab.id);
        if (!current?.document) return;
        const draft = current.dirty
          ? rebaseRenamedExternalReferences(current.draft, current.document.base_dir, result.oldPath, nextFilename)
          : latest.content;
        dispatch({ type: "DRAFT_CHANGED", id: current.id, content: draft });
        dispatch({ type: "SAVED", id: current.id, document: latest });
      }));
    setToast({
      id: String(Date.now()),
      message: `${result.updatedDocuments.length}文書・${result.updatedReferences}箇所の参照とファイル名を即時更新しました`,
      type: "success",
    });
    return true;
  }, []);

  const renameTab = useCallback(async (id: string) => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === id);
    if (!tab?.document || tab.untitled || tab.dirty || tab.saving || tab.deleted || isSharePointDocument(tab.document)) {
      throw new Error("未保存の編集がある、または名前を変更できないタブです。");
    }
    const currentName = getFileName(tab.path);
    const requestedName = window.prompt("新しいファイル名を入力してください", currentName)?.trim();
    if (!requestedName || requestedName === currentName) return;
    if (/[\\/]/.test(requestedName) || requestedName === "." || requestedName === "..") {
      throw new Error("ファイル名にフォルダー区切りを含めることはできません。");
    }
    const separatorIndex = Math.max(tab.path.lastIndexOf("\\"), tab.path.lastIndexOf("/"));
    const targetPath = separatorIndex >= 0 ? `${tab.path.slice(0, separatorIndex + 1)}${requestedName}` : requestedName;
    if (tabsStateRef.current.tabs.some((candidate) => candidate.id !== id && documentSourceIdentity(candidate.path) === documentSourceIdentity(targetPath))) {
      throw new Error("同じファイルを別のタブですでに開いています。");
    }
    let overwrite = false;
    try {
      const existing = await loadMarkdown(targetPath);
      if (existing.content !== tab.document.content && !window.confirm(`ファイルがすでに存在します: ${targetPath}\n\n上書きして名前を変更しますか？`)) return;
      overwrite = true;
    } catch {
      // 対象が存在しない場合は通常の名前変更を続行する。
    }
    const document = await renameDocument({ sourcePath: tab.path, targetPath, overwrite });
    dispatch({ type: "RENAMED", id, document });
    setToast({ id: crypto.randomUUID(), message: `${currentName} を ${getFileName(document.path)} に変更しました`, type: "success" });
  }, []);

  const renamePreviewImage = useCallback(async (context: ImageEditContext, filename: string) => {
    await renameExternalFile({
      documentPath: context.markdownPath,
      filePath: context.imagePath,
      source: context.source,
    }, filename);
    setMediaPreview(null);
  }, [renameExternalFile]);

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

  const closeTab = useCallback((id: string) => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === id);
    if (tab?.dirty && !window.confirm(`${tab.path}\n\n未保存の編集内容を破棄してタブを閉じますか？`)) return false;
    if (tab?.pendingAssets?.length) void discardStagedAssets(tab.pendingAssets.map((asset) => asset.id));
    if (tab && tab.kind !== "settings" && !tab.untitled) setClosedTabs((previous) => [{ path: tab.path, scrollTop: tab.scrollTop, searchOpen: tab.searchOpen, imageDisplaySizes: tab.imageDisplaySizes, search: tab.search }, ...previous].slice(0, 50));
    dispatch({ type: "CLOSE", id });
    return true;
  }, []);

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

  const changeEditorMode = useCallback((mode: EditorWorkspaceMode) => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabsStateRef.current.activeId);
    if (!tab?.document || tab.document.kind !== "markdown") return;
    dispatch({ type: "EDITOR_MODE", id: tab.id, mode });
  }, []);

  const updateCodeFenceBody = useCallback((occurrence: CodeFenceOccurrence, body: string): boolean => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabsStateRef.current.activeId);
    if (!tab?.document || tab.document.kind !== "markdown") return false;
    try {
      const content = replaceCodeFenceBody(tab.draft, occurrence, body);
      dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
      setToast({ id: crypto.randomUUID(), message: "コードブロックの変更をMarkdownドラフトへ反映しました", type: "success" });
      return true;
    } catch (error) {
      setToast({ id: crypto.randomUUID(), message: error instanceof Error ? error.message : String(error), type: "error" });
      return false;
    }
  }, []);

  const persistImmediateOccurrence = useCallback(async ({
    tabId,
    documentPath,
    draft,
    latest,
    occurrence,
    replacement,
    committedAssetIds = [],
  }: {
    tabId: string;
    documentPath: string;
    draft: string;
    latest: MarkdownLoadResult;
    occurrence: EditableMarkdownOccurrence;
    replacement: string;
    committedAssetIds?: string[];
  }) => {
    // Prepare both replacements before writing anything. This guarantees that
    // an unresolvable in-memory conflict cannot occur after storage changed.
    const nextStoredContent = replaceRelocatedOccurrence(latest.content, occurrence, replacement);
    const nextDraft = replaceRelocatedOccurrence(draft, occurrence, replacement);
    const currentTab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabId);
    const nextOpenedContent = replaceBestEffortOccurrence(currentTab?.openedContent ?? latest.content, occurrence, replacement);
    const identity = localPathIdentity(documentPath);
    const selfSaveUntil = Date.now() + 2000;
    recentSelfSaves.current.set(identity, selfSaveUntil);
    window.setTimeout(() => {
      if (recentSelfSaves.current.get(identity) === selfSaveUntil) recentSelfSaves.current.delete(identity);
    }, 2100);
    const result = await saveMarkdown({
      path: latest.path,
      content: nextStoredContent,
      expectedRevision: latest.revision,
      stagedAssetIds: committedAssetIds,
    });
    if (result.status === "conflict") throw new Error("保存直前にMarkdownが更新されました。最新状態を確認してから再実行してください。");
    dispatch({ type: "IMMEDIATE_SAVED", id: tabId, document: result.document, draft: nextDraft, openedContent: nextOpenedContent, committedAssetIds });
    setDocumentDiff((current) => current && localPathIdentity(current.path) === identity ? {
      ...current,
      openedContent: nextOpenedContent,
      storageContent: result.document.content,
      editingContent: nextDraft,
      storageRevision: result.document.revision,
      conflict: false,
    } : current);
    return result.document;
  }, []);

  const convertDocumentAsset = useCallback(async (context: AssetConversionContext) => {
    if (!confirmStorageConversion(context)) return;
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.document && localPathIdentity(candidate.document.path) === localPathIdentity(context.documentPath));
    if (!tab?.document || tab.document.kind !== "markdown" || isSharePointDocument(tab.document)) throw new Error("この文書は閲覧専用です。");
    const latest = await loadMarkdown(tab.document.path);
    if (latest.kind !== "markdown") throw new Error("最新のMarkdownを読み込めませんでした。");
    const latestOccurrence = relocateUnchangedOccurrence(latest.content, context.occurrence);
    if (context.storage === "embedded") {
      let extension: string;
      let base64: string | undefined;
      let text: string | undefined;
      if (context.assetKind === "raster" && latestOccurrence.kind === "image") {
        const parsed = parseRasterDataUri(latestOccurrence.source);
        if (!parsed) throw new Error("未対応のBase64ラスタ画像です。");
        ({ extension, base64 } = parsed);
      } else if (context.assetKind === "svg" && latestOccurrence.kind === "inline-svg") {
        extension = "svg"; text = sanitizeSvgXml(latestOccurrence.svg);
      } else throw new Error("この埋め込み形式は外部ファイルへ変換できません。");
      const staged = await stageDocumentAsset({ documentPath: tab.document.path, preferredFilename: preferredAssetFilename(context, extension), base64, text });
      const replacement = latestOccurrence.kind === "image"
        ? latestOccurrence.expected.replace(latestOccurrence.source, staged.filename)
        : `![SVG](${staged.filename})`;
      try {
        await persistImmediateOccurrence({ tabId: tab.id, documentPath: tab.document.path, draft: tab.draft, latest, occurrence: context.occurrence, replacement, committedAssetIds: [staged.id] });
      } catch (error) {
        await discardStagedAssets([staged.id]);
        throw error;
      }
      setMediaPreview(null);
      setToast({ id: String(Date.now()), message: `${staged.filename} へ外部化し、Markdownへ即時保存しました。`, type: "success" });
      return;
    }

    if (latestOccurrence.kind !== "image") throw new Error("外部アセットの参照形式が不正です。");
    const loaded = await readDocumentAsset(tab.document.path, latestOccurrence.source);
    let replacement: string;
    if (context.assetKind === "raster") {
      const mediaType = loaded.mediaType;
      const base64 = loaded.base64;
      if (!mediaType || !base64) throw new Error("ラスタ画像データを読み込めませんでした。");
      replacement = latestOccurrence.expected.replace(latestOccurrence.source, `data:${mediaType};base64,${base64}`);
    } else {
      const text = loaded.text;
      if (!text) throw new Error("SVG XMLを読み込めませんでした。");
      replacement = sanitizeSvgXml(text);
    }
    await persistImmediateOccurrence({ tabId: tab.id, documentPath: tab.document.path, draft: tab.draft, latest, occurrence: context.occurrence, replacement });
    setMediaPreview(null);
    setToast({ id: String(Date.now()), message: "埋め込み形式へ切り替え、Markdownへ即時保存しました。", type: "success", actions: [{ label: "外部ファイルを削除", onAction: () => deleteConvertedExternalAsset(tab.document!.path, latestOccurrence.source, loaded.revision ?? undefined) }] });
  }, [confirmStorageConversion, deleteConvertedExternalAsset, persistImmediateOccurrence]);

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

  const { printing, printStartedAt, printDocument } = useDocumentPrint({
    getSnapshot: () => !activeTab?.document ? null : ({
      tabId: activeTab.id,
      scrollTop: containerRef.current?.scrollTop ?? activeTab.scrollTop,
      viewMode: viewModeRef.current,
    }),
    restore: (snapshot) => {
      dispatch({ type: "SCROLL", id: snapshot.tabId, scrollTop: snapshot.scrollTop });
      if (viewModeRef.current !== snapshot.viewMode) {
        viewModeRef.current = snapshot.viewMode;
        setViewMode(snapshot.viewMode);
      }
      window.requestAnimationFrame(() => {
        if (tabsStateRef.current.activeId === snapshot.tabId && containerRef.current) {
          containerRef.current.scrollTop = snapshot.scrollTop;
        }
      });
    },
    onInfo: (message) => setToast({ id: String(Date.now()), message, type: "info" }),
    onError: (message) => setToast({ id: String(Date.now()), message, type: "error" }),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Handle F5 before modal-specific early returns. Otherwise the browser's
      // default reload can bypass the document-level discard protection.
      if (event.key === "F5") {
        event.preventDefault();
        if (shouldBlockF5Reload(activeTab)) {
          setToast({
            id: String(Date.now()),
            message: "未保存の編集内容があるため再読み込みを中止しました。保存してからF5を押してください。",
            type: "error",
          });
        } else {
          reload();
        }
        return;
      }
      if (isShortcutHelpShortcut(event)) {
        event.preventDefault();
        setShortcutHelpOpen(true);
        return;
      }
      if (shortcutHelpOpen) return;
      if (annotationTarget) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        focusNewDocumentRef.current = true;
        dispatch({ type: "NEW_MARKDOWN" });
        return;
      }
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

      if (event.key === "F2") {
        const focusedElement = document.activeElement instanceof Element ? document.activeElement : null;
        if (activeTab && editorRef.current?.contains(focusedElement)) {
          event.preventDefault();
          void renameTab(activeTab.id).catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeTab) void saveTab(activeTab.id);
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

      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === "Tab") {
        event.preventDefault();
        if (editorMode === "split") {
          const focused = document.activeElement instanceof Element ? document.activeElement : null;
          if (editorRef.current?.contains(focused)) containerRef.current?.focus();
          else editorRef.current?.focus();
        } else {
          activateRelativeTab(-1);
        }
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
  }, [activeTab, activateRelativeTab, annotationTarget, closeActiveTab, closeSearch, closedTabs, cropTarget, editorMode, goBack, goForward, openSearch, printDocument, reload, renameTab, saveTab, search, shortcutHelpOpen, toggleFoldAll, updateZoom]);

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
    const normalizedPath = resolveLocalImagePath(imgPath, "") ?? imgPath;
    setImageVersions((previous) => {
      const next = { ...previous, [imgPath]: (previous[imgPath] || 0) + 1 };
      if (normalizedPath !== imgPath) next[normalizedPath] = (previous[normalizedPath] || 0) + 1;
      return next;
    });
  }, []);

  const updateMarkdownTable = useCallback((occurrence: MarkdownTableOccurrence, replacement: string): boolean => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabsStateRef.current.activeId);
    if (!tab?.document || tab.document.kind !== "markdown" || isSharePointDocument(tab.document)) return false;
    try {
      const content = replaceMarkdownOccurrence(tab.draft, occurrence, replacement);
      dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
      setToast({ id: crypto.randomUUID(), message: "表の変更をMarkdownドラフトへ反映しました", type: "success" });
      return true;
    } catch (error) {
      setToast({ id: crypto.randomUUID(), message: error instanceof Error ? error.message : String(error), type: "error" });
      return false;
    }
  }, []);

  const convertDrawioStorage = useCallback(async (context: DrawioStorageConversionContext) => {
    if (!confirmStorageConversion(context)) return false;
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.document
      && localPathIdentity(candidate.document.path) === localPathIdentity(context.documentPath));
    if (!tab?.document || tab.document.kind !== "markdown" || isSharePointDocument(tab.document)) throw new Error("この文書は閲覧専用です。");
    const latest = await loadMarkdown(tab.document.path);
    if (latest.kind !== "markdown") throw new Error("最新のMarkdownを読み込めませんでした。");
    const latestOccurrence = relocateUnchangedOccurrence(latest.content, context.occurrence);

    if (context.storage === "embedded") {
      if (latestOccurrence.kind !== "code-fence") throw new Error("埋め込みdraw.ioの位置を確認できませんでした。");
      const staged = await stageConversionAsset({
        documentPath: tab.document.path,
        preferredFilename: normalizedAssetFilename(removeFilenameExtension(context.relativePath ?? codeFenceTitle(context.occurrence.meta) ?? ""), "drawio", "diagram"),
        preferredSource: context.relativePath ? appendFilenameExtension(context.relativePath, "drawio") : undefined,
        text: latestOccurrence.body,
      });
      if (!staged) return false;
      try {
        await persistImmediateOccurrence({
          tabId: tab.id,
          documentPath: tab.document.path,
          draft: tab.draft,
          latest,
          occurrence: context.occurrence,
          replacement: drawioExternalReference(staged.filename, context.alt),
          committedAssetIds: [staged.id],
        });
        setToast({
          id: crypto.randomUUID(),
          message: `${staged.filename} へ外部化し、Markdownへ即時保存しました。`,
          type: "success",
          onMessageClick: async () => {
            try { await openContainingFolder(tab.document!.path); }
            catch (error) { setToast({ id: crypto.randomUUID(), message: `保存フォルダーを開けませんでした: ${String(error)}`, type: "error" }); }
          },
        });
      } catch (error) {
        await discardStagedAssets([staged.id]);
        throw error;
      }
      return;
    }

    if (latestOccurrence.kind !== "image") throw new Error("外部draw.io参照の位置を確認できませんでした。");
    const asset = await readDocumentAsset(tab.document.path, latestOccurrence.source);
    if (!asset.text) throw new Error("draw.ioファイルの最新内容を読み込めませんでした。");
    await persistImmediateOccurrence({
      tabId: tab.id,
      documentPath: tab.document.path,
      draft: tab.draft,
      latest,
      occurrence: context.occurrence,
      replacement: embeddedFenceWithPath({
        language: "drawio",
        body: asset.text,
        relativePath: normalizeRelativeAssetPath(latestOccurrence.source) ?? asset.filename,
        alt: context.alt,
        style: embeddedPathStyle,
        lineEnding: markdownLineEnding(latest.content),
        continuationPrefix: markdownContinuationPrefix(latest.content, latestOccurrence.start),
      }),
    });
    setToast({ id: crypto.randomUUID(), message: "draw.ioを埋め込みへ切り替え、Markdownへ即時保存しました。", type: "success", actions: [{ label: "外部ファイルを削除", onAction: () => deleteConvertedExternalAsset(tab.document!.path, latestOccurrence.source, asset.revision ?? undefined) }] });
  }, [confirmStorageConversion, deleteConvertedExternalAsset, embeddedPathStyle, persistImmediateOccurrence, stageConversionAsset]);

  const convertMermaidStorage = useCallback(async (context: MermaidStorageConversionContext) => {
    if (!confirmStorageConversion(context)) return false;
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.document
      && localPathIdentity(candidate.document.path) === localPathIdentity(context.documentPath));
    if (!tab?.document || tab.document.kind !== "markdown" || isSharePointDocument(tab.document)) throw new Error("この文書は閲覧専用です。");
    const latest = await loadMarkdown(tab.document.path);
    if (latest.kind !== "markdown") throw new Error("最新のMarkdownを読み込めませんでした。");
    const latestOccurrence = relocateUnchangedOccurrence(latest.content, context.occurrence);

    if (context.storage === "embedded") {
      if (latestOccurrence.kind !== "code-fence") throw new Error("埋め込みMermaidの位置を確認できませんでした。");
      const staged = await stageConversionAsset({
        documentPath: tab.document.path,
        preferredFilename: normalizedAssetFilename(removeFilenameExtension(context.relativePath ?? codeFenceTitle(context.occurrence.meta) ?? ""), "mmd", "diagram"),
        preferredSource: context.relativePath ? appendFilenameExtension(context.relativePath, "mmd") : undefined,
        text: latestOccurrence.body,
      });
      if (!staged) return false;
      try {
        await persistImmediateOccurrence({
          tabId: tab.id,
          documentPath: tab.document.path,
          draft: tab.draft,
          latest,
          occurrence: context.occurrence,
          replacement: mermaidExternalReference(staged.filename, context.alt),
          committedAssetIds: [staged.id],
        });
        setToast({
          id: crypto.randomUUID(),
          message: `${staged.filename} へ外部化し、Markdownへ即時保存しました。`,
          type: "success",
          onMessageClick: async () => {
            try { await openContainingFolder(tab.document!.path); }
            catch (error) { setToast({ id: crypto.randomUUID(), message: `保存フォルダーを開けませんでした: ${String(error)}`, type: "error" }); }
          },
        });
      } catch (error) {
        await discardStagedAssets([staged.id]);
        throw error;
      }
      return;
    }

    if (latestOccurrence.kind !== "image") throw new Error("外部Mermaid参照の位置を確認できませんでした。");
    const asset = await readDocumentAsset(tab.document.path, latestOccurrence.source);
    if (!asset.text) throw new Error("Mermaidファイルの最新内容を読み込めませんでした。");
    await persistImmediateOccurrence({
      tabId: tab.id,
      documentPath: tab.document.path,
      draft: tab.draft,
      latest,
      occurrence: context.occurrence,
      replacement: embeddedFenceWithPath({
        language: "mermaid",
        body: asset.text,
        relativePath: normalizeRelativeAssetPath(latestOccurrence.source) ?? asset.filename,
        alt: context.alt,
        style: embeddedPathStyle,
        lineEnding: markdownLineEnding(latest.content),
        continuationPrefix: markdownContinuationPrefix(latest.content, latestOccurrence.start),
      }),
    });
    setToast({ id: crypto.randomUUID(), message: "Mermaidを埋め込みへ切り替え、Markdownへ即時保存しました。", type: "success", actions: [{ label: "外部ファイルを削除", onAction: () => deleteConvertedExternalAsset(tab.document!.path, latestOccurrence.source, asset.revision ?? undefined) }] });
  }, [confirmStorageConversion, deleteConvertedExternalAsset, embeddedPathStyle, persistImmediateOccurrence, stageConversionAsset]);

  const convertTableStorage = useCallback(async (context: TableStorageConversionContext) => {
    if (!confirmStorageConversion(context)) return false;
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.document
      && localPathIdentity(candidate.document.path) === localPathIdentity(context.documentPath));
    if (!tab?.document || tab.document.kind !== "markdown" || isSharePointDocument(tab.document)) throw new Error("この文書は閲覧専用です。");
    const latest = await loadMarkdown(tab.document.path);
    if (latest.kind !== "markdown") throw new Error("最新のMarkdownを読み込めませんでした。");
    const latestOccurrence = relocateUnchangedOccurrence(latest.content, context.occurrence);

    if (context.storage === "embedded") {
      if (latestOccurrence.kind !== "code-fence") throw new Error("埋め込み表の位置を確認できませんでした。");
      const staged = await stageConversionAsset({
        documentPath: tab.document.path,
        preferredFilename: normalizedAssetFilename(removeFilenameExtension(context.relativePath ?? codeFenceTitle(latestOccurrence.meta) ?? ""), context.language.startsWith("csv") ? "csv" : "tsv", "table"),
        preferredSource: context.relativePath ? appendFilenameExtension(context.relativePath, context.language.startsWith("csv") ? "csv" : "tsv") : undefined,
        text: latestOccurrence.body,
      });
      if (!staged) return false;
      try {
        await persistImmediateOccurrence({
          tabId: tab.id,
          documentPath: tab.document.path,
          draft: tab.draft,
          latest,
          occurrence: context.occurrence,
          replacement: `![${context.language.toUpperCase()}表](${staged.filename})`,
          committedAssetIds: [staged.id],
        });
      } catch (error) {
        await discardStagedAssets([staged.id]);
        throw error;
      }
      setToast({ id: crypto.randomUUID(), message: `${staged.filename} へ書き出し、Markdownへ即時保存しました。`, type: "success" });
      return;
    }

    if (latestOccurrence.kind !== "image") throw new Error("外部表参照の位置を確認できませんでした。");
    const asset = await readDocumentAsset(tab.document.path, latestOccurrence.source);
    if (asset.text === null || asset.text === undefined) throw new Error("表ファイルの最新内容を読み込めませんでした。");
    const lineEnding = markdownLineEnding(latest.content);
    const body = asset.text.replace(/^\uFEFF/, "").replace(/[\r\n]+$/, "");
    await persistImmediateOccurrence({
      tabId: tab.id,
      documentPath: tab.document.path,
      draft: tab.draft,
      latest,
      occurrence: context.occurrence,
      replacement: embeddedFenceWithPath({
        language: context.language,
        body,
        relativePath: normalizeRelativeAssetPath(latestOccurrence.source) ?? asset.filename,
        style: embeddedPathStyle,
        lineEnding,
        continuationPrefix: markdownContinuationPrefix(latest.content, latestOccurrence.start),
      }),
    });
    setToast({ id: crypto.randomUUID(), message: "表を埋め込みへ切り替え、Markdownへ即時保存しました。", type: "success", actions: [{ label: "外部ファイルを削除", onAction: () => deleteConvertedExternalAsset(tab.document!.path, latestOccurrence.source, asset.revision ?? undefined) }] });
  }, [confirmStorageConversion, deleteConvertedExternalAsset, embeddedPathStyle, persistImmediateOccurrence, stageConversionAsset]);

  const convertTextStorage = useCallback(async (context: TextStorageConversionContext) => {
    if (!confirmStorageConversion(context)) return false;
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.document
      && localPathIdentity(candidate.document.path) === localPathIdentity(context.documentPath));
    if (!tab?.document || tab.document.kind !== "markdown" || isSharePointDocument(tab.document)) throw new Error("この文書は閲覧専用です。");
    const latest = await loadMarkdown(tab.document.path);
    if (latest.kind !== "markdown") throw new Error("最新のMarkdownを読み込めませんでした。");
    const latestOccurrence = relocateUnchangedOccurrence(latest.content, context.occurrence);

    if (context.storage === "embedded") {
      if (latestOccurrence.kind !== "code-fence") throw new Error("埋め込みコードの位置を確認できませんでした。");
      const extension = sourceExtensionForLanguage(context.language);
      const staged = await stageConversionAsset({
        documentPath: tab.document.path,
        preferredFilename: normalizedAssetFilename(removeFilenameExtension(context.relativePath ?? codeFenceTitle(latestOccurrence.meta) ?? ""), extension, "code"),
        preferredSource: context.relativePath ? appendFilenameExtension(context.relativePath, extension) : undefined,
        text: latestOccurrence.body,
      });
      if (!staged) return false;
      try {
        await persistImmediateOccurrence({
          tabId: tab.id,
          documentPath: tab.document.path,
          draft: tab.draft,
          latest,
          occurrence: context.occurrence,
          replacement: textExternalReference(staged.filename),
          committedAssetIds: [staged.id],
        });
      } catch (error) {
        await discardStagedAssets([staged.id]);
        throw error;
      }
      setToast({ id: crypto.randomUUID(), message: `${staged.filename} へ外部化し、Markdownへ即時保存しました。`, type: "success" });
      return;
    }

    if (latestOccurrence.kind !== "image") throw new Error("外部テキスト参照の位置を確認できませんでした。");
    const asset = await readDocumentAsset(tab.document.path, latestOccurrence.source);
    if (asset.text === null || asset.text === undefined) throw new Error("外部テキストの最新内容を読み込めませんでした。");
    await persistImmediateOccurrence({
      tabId: tab.id,
      documentPath: tab.document.path,
      draft: tab.draft,
      latest,
      occurrence: context.occurrence,
      replacement: embeddedFenceWithPath({
        language: context.language,
        body: asset.text.replace(/^\uFEFF/, ""),
        relativePath: normalizeRelativeAssetPath(latestOccurrence.source) ?? asset.filename,
        style: embeddedPathStyle,
        lineEnding: markdownLineEnding(latest.content),
        continuationPrefix: markdownContinuationPrefix(latest.content, latestOccurrence.start),
      }),
    });
    setToast({ id: crypto.randomUUID(), message: "外部テキストを埋め込みへ切り替え、Markdownへ即時保存しました。", type: "success", actions: [{ label: "外部ファイルを削除", onAction: () => deleteConvertedExternalAsset(tab.document!.path, latestOccurrence.source, asset.revision ?? undefined) }] });
  }, [confirmStorageConversion, deleteConvertedExternalAsset, embeddedPathStyle, persistImmediateOccurrence, stageConversionAsset]);

  const updateStagedTextAssetContent = useCallback(async (filename: string, text: string): Promise<boolean> => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === tabsStateRef.current.activeId);
    const asset = tab?.pendingAssets?.find((candidate) => candidate.filename === filename && candidate.text !== undefined);
    if (!tab || !asset) return false;
    await updateStagedTextAsset(asset.id, text);
    dispatch({ type: "STAGED_ASSET_UPDATED", id: tab.id, stagingId: asset.id, text });
    return true;
  }, []);

  const stageExternalTableEdit = useCallback(async (context: ExternalTableChangeContext): Promise<boolean> => {
    const tab = tabsStateRef.current.tabs.find((candidate) => candidate.document
      && localPathIdentity(candidate.document.path) === localPathIdentity(context.documentPath));
    if (!tab?.document || tab.document.kind !== "markdown" || isSharePointDocument(tab.document)) return false;
    const source = normalizeRelativeAssetPath(context.source);
    if (!source) throw new Error("外部表の保存先がMarkdownフォルダー内の相対パスではありません。");
    const existing = tab.pendingAssets?.find((asset) => asset.filename === source && asset.text !== undefined);
    if (existing) {
      await updateStagedTextAsset(existing.id, context.text);
      dispatch({ type: "STAGED_ASSET_UPDATED", id: tab.id, stagingId: existing.id, text: context.text });
    } else {
      const staged = await stageDocumentAsset({
        documentPath: tab.document.path,
        preferredFilename: source.slice(source.lastIndexOf("/") + 1) || `table.${source.toLowerCase().endsWith(".csv") ? "csv" : "tsv"}`,
        preferredSource: source,
        text: context.text,
      });
      dispatch({ type: "STAGED_ASSET_ADDED", id: tab.id, content: tab.draft, asset: { ...staged, text: context.text } });
    }
    setToast({ id: crypto.randomUUID(), message: `${source} の変更を一時保存しました。文書の保存時に反映します。`, type: "success" });
    return true;
  }, []);

  const handleMarkdownChanged = useCallback(
    ({ path, changeKind }: { path: string; changeKind: string }) => {
      const identity = localPathIdentity(path);
      if (Object.values(diagnosticWatchTargets).some((targets) => targets.some((target) => localPathIdentity(target) === identity))) {
        setDiagnosticsRefresh((value) => value + 1);
      }
      const tabs = tabsStateRef.current.tabs.filter((candidate) => localPathIdentity(candidate.path) === identity);
      if (!tabs.length) {
        if (changeKind !== "deleted" && changeKind !== "renamed") updateImageVersion(path);
        return;
      }
      const canReload = changeKind !== "deleted" && changeKind !== "renamed";
      tabs.forEach((tab) => {
        if (!canReload) dispatch({ type: "STORAGE_UNAVAILABLE", id: tab.id, error: "ファイルが削除または移動されました。", deleted: true });
        else void refreshTabStorage(tab.id);
      });
    },
    [diagnosticWatchTargets, refreshTabStorage, updateImageVersion]
  );

  const handleImageChanged = useCallback(
    ({ path, changeKind }: { path: string; changeKind: string }) => {
      const identity = localPathIdentity(path);
      if (Object.values(diagnosticWatchTargets).some((targets) => targets.some((target) => localPathIdentity(target) === identity))) {
        setDiagnosticsRefresh((value) => value + 1);
      }
      if (changeKind !== "deleted" && changeKind !== "renamed") updateImageVersion(path);
    },
    [diagnosticWatchTargets, updateImageVersion]
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
  const requestedPanelForView = resolveDocumentPanelForView(viewMode, requestedDocumentPanel);
  const documentSidePanel = activeTab?.document
    ? resolveDocumentSidePanel(Boolean(activeTab.searchOpen), requestedPanelForView)
    : null;
  const scopedMarkdownStyle = scopeMarkdownStyleCss(markdownStyleCss) ?? "";

  return (
    <DocumentSaveContext.Provider value={async () => {
      const id = activeTab?.id;
      if (!id || id !== tabsStateRef.current.activeId) return false;
      await saveTab(id);
      return !tabsStateRef.current.tabs.find(tab => tab.id === id)?.dirty;
    }}>
    <div className={`app-container${printing ? " is-printing" : ""}`} data-print-fold-mode={printStyle.foldMode}>
      <style data-markdown-custom-style>{scopedMarkdownStyle}</style>
      {printing && activeTab?.document && <PrintMetadata path={activeTab.document.path} startedAt={printStartedAt} settings={printStyle} />}
      <TabBar tabs={tabsState.tabs} activeId={tabsState.activeId} onActivate={activateTab} onClose={closeTab} onMove={(id, toIndex) => dispatch({ type: "MOVE", id, toIndex })} onContext={(id, x, y) => setContextTab({ id, x, y })} />
      {activeTab?.kind !== "settings" && <div className="view-controls" aria-label="表示と文書の操作">
        <div className="control-group document-actions">
          <button type="button" disabled={printing} onClick={() => { focusNewDocumentRef.current = true; dispatch({ type: "NEW_MARKDOWN" }); }}>新規MD</button>
          <button type="button" disabled={printing} onClick={() => void openDocument()}>開く</button>
          <button data-ui-command="document.print" type="button" disabled={!activeTab?.document || printing || editorMode === "edit"} onClick={() => void printDocument()}>印刷</button>
          <DesktopHtmlExport disabled={!activeTab?.document || printing} getSnapshot={() => activeTab?.document ? { document: activeTab.document, content: activeMarkdownContent, theme: theme === "system" ? document.documentElement.dataset.theme ?? "light" : theme, css: markdownStyleCss, assets: activeTab.pendingAssets ?? [] } : null} />
          <DiagnosticsPanel items={diagnostics} isOpen={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} onSelect={jumpToDiagnostic} />
          <button type="button" disabled={!activeTab?.document || activeTab.untitled} onClick={reload}>再読込</button>
          <button data-ui-command="document.save" type="button" disabled={!activeTab?.dirty || activeTab.saving} onClick={() => activeTab && void saveTab(activeTab.id)}>{activeTab?.saving ? "保存中…" : "保存"}</button>
        </div>
        <div className="control-group editor-mode-controls" aria-label="編集画面">
          <WorkspaceViewControls betweenPreviewAndDirection={<button data-ui-command="document.diff" type="button" className="document-action-button" aria-pressed={documentDiff !== null} disabled={!canEditActive || activeTab?.untitled} onClick={() => void toggleDocumentDiff()}>差分</button>} code={editorMode !== "preview"} preview={editorMode === "edit" ? "off" : previewMode === "off" ? "preview" : previewMode} direction={splitDirection} disabled={!canEditActive} onDirectionChange={setSplitDirection} onChange={(code, preview) => { setPreviewMode(preview); changeEditorMode(preview === "off" ? "edit" : code ? "split" : "preview"); }} />
        </div>
        <ExternalActions
          apps={activeSharePoint ? [] : externalApps.filter((app) => app.target === "document")}
          disabled={!activeTab?.document || activeTab.untitled}
          onExecute={executeExternalApp}
          onOpenInNewWindow={() => {
            if (!activeTab?.document) return;
            void openInNewWindow(activeTab.path).catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
          }}
        />
        {autoReload === "manual" && activeTab?.externalChanged && <button type="button" className="pending-reload" onClick={reload}>変更あり: 再読込</button>}
        <button ref={codexButtonRef} className="codex-toolbar-action" type="button" disabled={printing} aria-expanded={codexOpen} onClick={() => {
          setCodexOpen(!codexOpen);
        }}>AI</button>
      </div>}

      <div className={`ai-document-layout${codexOpen && codexMaximized ? " ai-document-layout--maximized" : ""}`}>
      <div className={`document-workspace editor-workspace-${editorMode}`} data-direction={splitDirection}>
      {documentDiff && activeTab?.document?.kind === "markdown" && documentSourceIdentity(documentDiff.path) === documentSourceIdentity(activeTab.path) ? <DocumentDiffWorkspace
        key={activeTab.id}
        target={documentDiffTarget(activeTab, documentDiff.conflict)}
        editorMode={editorMode}
        theme={theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
        onEditingChange={isSharePointDocument(activeTab.document) ? undefined : (content) => dispatch({ type: "DRAFT_CHANGED", id: activeTab.id, content })}
        onSave={isSharePointDocument(activeTab.document) ? undefined : () => void saveTab(activeTab.id)}
        onReviewChange={updateDiffReview}
        onRefresh={() => void refreshTabStorage(activeTab.id, false)}
        saving={activeTab.saving}
      /> : <>
      {activeTab?.document && <DocumentSidePanel
        activeTab={documentSidePanel}
        onTabChange={changeDocumentSidePanel}
        onClose={documentSidePanel === "search" ? closeSearch : closeDocumentSidePanel}
        disabledTabs={viewMode === "presentation" ? ["images"] : []}
        toc={<DocumentToc
          markdown={previewContent}
          isOpen
          embedded
          activeHeadingId={viewMode === "presentation" ? presentationPositions[activeTab.id] : activeTocHeadingId ?? undefined}
          onOpenChange={() => undefined}
          onJump={jumpToTocHeading}
          onMove={canEditActive && viewMode !== "presentation" ? moveTocHeading : undefined}
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
      <div className={`document-panes editor-workspace-${editorMode}`} data-direction={splitDirection}>
      {canEditActive && editorMode !== "preview" && activeTab?.document && <Suspense fallback={<div className="markdown-editor-loading">エディターを読み込んでいます…</div>}>
        <MarkdownEditor
          onCodexConsult={!printing && !activeTab.saving ? (target) => { setCodexTarget(target); setCodexOpen(true); } : undefined}
          ref={editorRef}
          documentId={`${activeTab.id}:${activeTab.generation}`}
          viewStateKey={activeTab.path}
          codeBlockFoldMinLines={codeBlockFoldMinLines}
          value={activeTab.draft}
          dirty={activeTab.dirty}
          saving={activeTab.saving}
          onChange={(content) => dispatch({ type: "DRAFT_CHANGED", id: activeTab.id, content })}
          onSave={() => void saveTab(activeTab.id)}
          onResolvePastedImage={resolvePastedImage}
          onResolveFileAttachment={async (file) => {
            const tab = tabsStateRef.current.tabs.find(candidate => candidate.id === activeTab.id);
            if (!tab?.document || tab.untitled) throw new Error("添付ファイルの保存先を決めるため、先に本文を保存してください。");
            const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
            const asset = await stageDocumentAsset({ documentPath: tab.document.path, preferredFilename: file.name, base64: data.slice(data.indexOf(",") + 1) });
            return { source: asset.filename, asset };
          }}
          onStagedAssetAdded={(content, asset) => dispatch({ type: "STAGED_ASSET_ADDED", id: activeTab.id, content, asset })}
          onStagedAssetAbandoned={(asset) => void discardStagedAssets([asset.id])}
          onPasteImageError={(error) => setToast({ id: crypto.randomUUID(), message: `画像の貼り付けに失敗しました: ${String(error)}`, type: "error" })}
          onLineEndingsNormalized={(lineEnding) => setToast({
            id: crypto.randomUUID(),
            message: `混在していた改行コードを${lineEnding === "\r\n" ? "CRLF" : lineEnding === "\r" ? "CR" : "LF"}へ統一しました。保存するとファイルへ反映されます。`,
            type: "success",
          })}
          onScrollLine={editorMode === "split" ? handleEditorScrollLine : undefined}
          onActiveLineChange={editorMode === "split" ? setActiveEditorLine : undefined}
          onCursorPositionChange={editorMode === "split" ? handleEditorCursorPosition : undefined}
        />
      </Suspense>}
      {(editorMode !== "edit" || !canEditActive) && <section className="preview-pane">
        {activeTab?.kind !== "settings" && activeTab?.document && <div className="preview-panel-toolbar" aria-label="プレビューの操作">
          {viewMode !== "presentation" && <label className="preview-panel-toolbar__heading">見出し
            <select aria-label="見出しの表示" defaultValue="" onChange={(event) => {
              const value = event.target.value as "expand" | "collapse" | "h1" | "h2" | "h3" | "current" | "reset";
              if (value) applyFoldPreset(value);
              event.currentTarget.value = "";
            }}>
              <option value="" disabled>操作を選択</option><option value="expand">すべて展開</option><option value="collapse">すべて折りたたむ</option><option value="h1">H1のみ表示</option><option value="h2">H2まで表示</option><option value="h3">H3まで表示</option><option value="current">現在位置以外を折りたたむ</option><option value="reset">状態をリセット</option>
            </select>
          </label>}
          <label>レイアウト
            <select aria-label="レイアウト" value={viewMode} onChange={(event) => changeViewMode(event.target.value as ViewMode)}>
              <optgroup label="本文レイアウト"><option value="auto">オート</option><option value="a4-portrait">A4縦</option><option value="a3-portrait">A3縦</option></optgroup>
              <optgroup label="表示モード"><option value="presentation">プレゼン</option><option value="images">画像中心</option></optgroup>
            </select>
          </label>
        </div>}
      <main
        className={`preview-container ${activeTab?.kind === "settings" ? "view-settings" : `view-${viewMode}`}`}
        ref={containerRef}
        tabIndex={-1}
        onScroll={(event) => handlePreviewScroll(event.currentTarget)}
        onClickCapture={handlePreviewClick}
        onContextMenu={handlePreviewContextMenu}
        onPointerMove={handlePreviewPointerMove}
        onPointerLeave={handlePreviewPointerLeave}
        onFocusCapture={(event) => setFocusedLinkTarget(documentLinkTarget(event.target))}
        onBlurCapture={(event) => setFocusedLinkTarget(documentLinkTarget(event.relatedTarget))}
        style={{ zoom: viewMode === "presentation" && activeTab?.document?.kind === "markdown" ? 1 : zoom / 100 }}
      >
        {activeTab?.kind === "settings" ? (
          <SettingsPanel
            apps={externalApps}
            presentationLineThreshold={presentationLineThreshold}
            codeBlockFoldMinLines={codeBlockFoldMinLines}
            imageA4TargetWidth={imageA4TargetWidth}
            imageEqualPadding={imageEqualPadding}
            clipboardImage={clipboardImage}
            embeddedPathStyle={embeddedPathStyle}
            syntaxHighlight={syntaxHighlight}
            printStyle={printStyle}
            markdownStyle={markdownStyle}
            markdownStyleCss={markdownStyleCss}
            markdownStylePath={markdownStylePath}
            onOpenMarkdownStyle={openMarkdownStyleFile}
            onReloadMarkdownStyle={reloadMarkdownStyle}
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
        ) : activeTab?.document && activeTab.document.kind !== "markdown" ? (
          <StandaloneDocumentPreview
            document={{ ...activeTab.document, content: activeTab.draft }}
            imageVersions={imageVersions}
            contentRef={markdownRef}
            theme={printing ? "light" : theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
            windowId={windowLabel}
            tabId={activeTab.id}
            onMediaOpen={openMediaPreview}
            onDrawioSave={activeTab.document.kind === "drawio" ? (content) => saveStandaloneDrawio(activeTab.id, content) : undefined}
            onTextChange={canEditActive && !printing && ["tsv", "svg", "mermaid"].includes(activeTab.document.kind) ? (content) => { dispatch({ type: "DRAFT_CHANGED", id: activeTab.id, content }); } : undefined}
            enableCodex={canEditActive && !printing}
          />
        ) : activeTab?.document && viewMode === "presentation" ? (
          <PresentationView
           content={previewContent}
           baseDir={activeTab.document.base_dir}
            sourcePath={activeTab.path}
            imageVersions={imageVersions}
            theme={printing ? "light" : theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
            onError={handlePreviewError}
            mermaidMode="on"
            windowId={windowLabel}
            tabId={activeTab.id}
            contentRef={markdownRef}
            imageDisplaySizes={activeTab.imageDisplaySizes}
            onOpenDocument={handleOpenDocument}
            onOpenDocumentWindow={handleOpenDocumentWindow}
            lineThreshold={presentationLineThreshold}
            initialHeadingId={presentationPositions[activeTab.id]}
            searchSourceLine={presentationSearchLines[activeTab.id]}
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
            enablePointerBlockReorder={visualEditing}
            readOnly={!visualEditing}
            allowBlockActions={canEditActive && !printing && !activeTab.saving}
            content={previewContent}
            baseDir={activeTab.document.base_dir}
            onTextEdit={canEditActive && !printing && !activeTab.saving ? (baseContent, from, to, replacement) => {
              const tab = tabsStateRef.current.tabs.find(candidate => candidate.id === activeTab.id);
              if (!tab || tab.id !== tabsStateRef.current.activeId || tab.generation !== activeTab.generation || tab.saving) return false;
              const documentId = `${tab.id}:${tab.generation}`;
              const content = replaceDocumentText({ documentId, content: tab.draft, from: 0, to: tab.draft.length }, { documentId, content: baseContent, from, to }, replacement);
              if (content === null) return false;
              previewEditHistory.current.record(documentId, tab.draft, content);
              dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
              return true;
            } : undefined}
            onTextUndo={canEditActive && !printing ? redo => {
              const tab = tabsStateRef.current.tabs.find(candidate => candidate.id === activeTab.id);
              if (!tab || tab.id !== tabsStateRef.current.activeId || tab.generation !== activeTab.generation || tab.saving) return;
              const content = previewEditHistory.current.restore(`${tab.id}:${tab.generation}`, tab.draft, redo);
              if (content !== null) dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
            } : undefined}
            imageVersions={imageVersions}
            contentRef={markdownRef}
            theme={printing ? "light" : theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
            onError={handlePreviewError}
            foldState={foldStates[activeTab.path]}
            onFoldChange={handleFoldChange}
            mermaidMode="on"
            windowId={windowLabel}
            tabId={activeTab.id}
            imageDisplaySizes={activeTab.imageDisplaySizes}
            onImageDisplaySizeChange={handleImageDisplaySizeChange}
            onCodexImageSelect={canEditActive && !printing && !activeTab.saving ? (offset) => {
              setCodexImageTarget({ documentId: activeTab.id, offset });
              setCodexOpen(true);
            } : undefined}
            onCodexConsult={canEditActive && !printing && !activeTab.saving ? (target) => {
              setCodexTarget({ ...target, documentId: `${activeTab.id}:${activeTab.generation}` });
              setCodexOpen(true);
            } : undefined}
            searchExpandedIds={searchExpandedIds}
            onSearchFoldManualOverride={handleSearchFoldManualOverride}
            onOpenDocument={handleOpenDocument}
            onOpenDocumentWindow={handleOpenDocumentWindow}
            onMediaOpen={openMediaPreview}
            documentPath={activeSharePoint ? undefined : activeTab.path}
            sourcePath={activeTab.path}
            onCodeHighlightComplete={handleCodeHighlightComplete}
            onCodeFenceBodyChange={updateCodeFenceBody}
            onInlineSvgChange={(occurrence, source) => {
              const tab = tabsStateRef.current.tabs.find((candidate) => candidate.id === activeTab.id);
              if (!tab || tab.saving || tab.id !== tabsStateRef.current.activeId) return false;
              try {
                const content = replaceMarkdownOccurrence(tab.draft, occurrence, sanitizeSvgXml(source));
                dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
                return true;
              } catch { return false; }
            }}
            onMarkdownTableChange={updateMarkdownTable}
            onDrawioStorageConvert={convertDrawioStorage}
            onMermaidStorageConvert={convertMermaidStorage}
            onTableStorageConvert={convertTableStorage}
            onTextStorageConvert={convertTextStorage}
            onExternalFileRename={renameExternalFile}
            onExternalTableChange={stageExternalTableEdit}
            onStagedTextAssetChange={updateStagedTextAssetContent}
            stagedAssetPreviews={Object.fromEntries((activeTab.pendingAssets ?? []).flatMap((asset) => asset.previewSource ? [[asset.filename, asset.previewSource]] : []))}
            stagedDrawioSources={Object.fromEntries((activeTab.pendingAssets ?? []).flatMap((asset) => asset.text !== undefined && /\.drawio$/i.test(asset.filename) ? [[asset.filename, asset.text]] : []))}
            stagedMermaidSources={Object.fromEntries((activeTab.pendingAssets ?? []).flatMap((asset) => asset.text !== undefined && /\.(?:mmd|mermaid)$/i.test(asset.filename) ? [[asset.filename, asset.text]] : []))}
            stagedTableSources={Object.fromEntries((activeTab.pendingAssets ?? []).flatMap((asset) => asset.text !== undefined && /\.(?:csv|tsv)$/i.test(asset.filename) ? [[asset.filename, asset.text]] : []))}
            stagedTextSources={Object.fromEntries((activeTab.pendingAssets ?? []).flatMap((asset) => asset.text !== undefined ? [[asset.filename, asset.text]] : []))}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📑</div>
            <div className="empty-title">表示するファイルが指定されていません</div>
            <div className="empty-desc">
              <code>.md</code>、<code>.svg</code>、<code>.mmd</code>、<code>.drawio</code> ファイルをダブルクリックして開くか、ドロップしてください。
            </div>
          </div>
        )}
      </main></section>}
      </div>
      </>}
      </div>
      {codexOpen && <CodexPanel
        key={`${activeTab?.id ?? "none"}:${activeTab?.generation ?? 0}`}
        open={codexOpen}
        maximized={codexMaximized}
        onToggleMaximized={() => setCodexMaximized(value => !value)}
        onClose={() => { setCodexOpen(false); codexButtonRef.current?.focus(); }}
        documentName={activeTab?.path.split(/[\\/]/).pop() ?? ""}
        documentPath={activeTab?.document?.path ?? ""}
        baseDir={activeTab?.document?.base_dir ?? ""}
        imageTarget={codexImageTarget?.documentId === activeTab?.id ? codexImageTarget : null}
        consultationTarget={activeTab && codexTarget?.documentId === `${activeTab.id}:${activeTab.generation}` ? codexTarget : null}
        stagedImages={Object.fromEntries((activeTab?.pendingAssets ?? []).flatMap((asset) => asset.previewSource ? [[asset.filename, asset.previewSource]] : []))}
        documentText={activeTab?.draft ?? ""}
        available={Boolean(canEditActive && !activeTab?.saving)}
        getSnapshot={() => {
          const tab = tabsStateRef.current.tabs.find(item => item.id === tabsStateRef.current.activeId);
          if (!tab || tab.saving) return null;
          return !documentDiff && editorMode !== "preview" ? editorRef.current?.snapshot() ?? null : { documentId: `${tab.id}:${tab.generation}`, content: tab.draft, from: 0, to: tab.draft.length };
        }}
        applyProposal={(base, replacement) => {
          if (!canEditActive || activeTab?.saving) return false;
          if (documentDiff || editorMode === "preview") {
            const tab = tabsStateRef.current.tabs.find(item => item.id === tabsStateRef.current.activeId);
            if (!tab || tab.saving) return false;
            const content = replaceDocumentText({ documentId: `${tab.id}:${tab.generation}`, content: tab.draft, from: 0, to: tab.draft.length }, base, replacement);
            if (content === null) return false;
            previewEditHistory.current.record(`${tab.id}:${tab.generation}`, tab.draft, content);
            dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
            return true;
          }
          return Boolean(editorRef.current?.applyProposal(base, replacement));
        }}
      />}
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
        imageVersion={annotationTarget.fullPath ? imageVersions[annotationTarget.fullPath] ?? 0 : 0}
        onApply={async ({ filename, backupAvailable, dataUri }) => {
          if (annotationTarget.storage === "sharepoint" && dataUri && annotationTarget.sharePoint) {
            const parsed = parseRasterDataUri(dataUri);
            if (!parsed || parsed.mediaType !== "image/png") throw new Error("編集結果をPNGとして生成できませんでした。");
            await saveSharePointAsset({
              documentPath: annotationTarget.sharePoint.documentPath,
              source: annotationTarget.sharePoint.source,
              expectedRevision: annotationTarget.sharePoint.revision,
              mediaType: "image/png",
              base64: parsed.base64,
            });
            updateImageVersion(`${annotationTarget.sharePoint.documentPath}|${annotationTarget.sharePoint.source}`);
          } else if (annotationTarget.storage === "embedded" && dataUri && annotationTarget.conversionContext) {
            const context = annotationTarget.conversionContext;
            const tab = tabsStateRef.current.tabs.find((candidate) => candidate.document
              && documentSourceIdentity(candidate.document.path) === documentSourceIdentity(context.documentPath));
            if (!tab || context.occurrence.kind !== "image") {
              handleCropError("Base64画像の反映先が見つかりません。");
              return;
            }
            try {
              const content = replaceImageOccurrenceSource(tab.draft, context.occurrence, dataUri);
              dispatch({ type: "DRAFT_CHANGED", id: tab.id, content });
            } catch (error) {
              handleCropError(`Base64画像の反映に失敗しました: ${String(error)}`);
              return;
            }
          } else if (annotationTarget.storage === "external" && annotationTarget.fullPath) {
            updateImageVersion(annotationTarget.fullPath);
            setImageBackups((current) => ({ ...current, [annotationTarget.fullPath!]: backupAvailable }));
          }
          setAnnotationTarget(null);
          setAnnotationReturnPreview(null);
          setToast({
            id: String(Date.now()),
            message: `${filename} の画像編集を反映しました`,
            type: "success",
            restorePath: annotationTarget.storage === "external" && backupAvailable ? annotationTarget.fullPath : undefined,
          });
        }}
        onCancel={() => {
          setAnnotationTarget(null);
          setMediaPreview(annotationReturnPreview);
          setAnnotationReturnPreview(null);
        }}
        onError={handleCropError}
      />}

      {svgEditorTarget && <SvgSourceEditor
        target={svgEditorTarget}
        onSave={async (svg) => {
          await saveSharePointAsset({
            documentPath: svgEditorTarget.documentPath,
            source: svgEditorTarget.source,
            expectedRevision: svgEditorTarget.revision,
            mediaType: "image/svg+xml",
            text: svg,
          });
          updateImageVersion(`${svgEditorTarget.documentPath}|${svgEditorTarget.source}`);
          setSvgEditorTarget(null);
          setMediaPreview(null);
          setToast({ id: String(Date.now()), message: `${svgEditorTarget.filename} のSVG編集をSharePointへ保存しました`, type: "success" });
        }}
        onCancel={() => setSvgEditorTarget(null)}
      />}

      <Toast
        toast={toast}
        onRestore={handleRestore}
        onClose={() => setToast(null)}
      />
      {mediaPreview && <MediaPreviewModal
        content={mediaPreview.content}
        headingTitle={mediaPreview.headingTitle}
        diagramSource={mediaPreview.diagramSource}
        diagramKind={mediaPreview.diagramKind}
        imageContext={mediaPreview.imageContext}
        conversionContext={mediaPreview.conversionContext}
        onConvertAsset={convertDocumentAsset}
        onSaveCaption={saveImageCaption}
        onRenameImage={renamePreviewImage}
        imageApps={externalApps.filter((app) => app.target === "image")}
        onOpenImageApp={executeImageApp}
        initialViewState={mediaPreviewInitialViewState}
        onViewStateChange={handleMediaPreviewViewState}
        onClose={closeMediaPreview}
        onMediaClick={mediaPreview.cropTarget ? () => {
          closeMediaPreview();
          startCrop(mediaPreview.cropTarget!);
        } : undefined}
        onActivate={mediaPreview.editTarget ? () => {
          setAnnotationReturnPreview(mediaPreview);
          setMediaPreview(null);
          setAnnotationTarget(mediaPreview.editTarget!);
        } : mediaPreview.svgEditTarget ? () => {
          setMediaPreview(null);
          setSvgEditorTarget(mediaPreview.svgEditTarget!);
        } : undefined}
        editDisabledReason={mediaPreview.editDisabledReason}
        onCrop={mediaPreview.cropTarget ? () => {
          closeMediaPreview();
          startCrop(mediaPreview.cropTarget!);
        } : undefined}
      />}
      {shortcutHelpOpen && <ShortcutHelpModal onClose={() => setShortcutHelpOpen(false)} />}
      {editingTestReportOpen && <Suspense fallback={null}><EditingTestReport onClose={() => setEditingTestReportOpen(false)} /></Suspense>}
      {sharePointAuthPrompt && <SharePointAuthDialog
        prompt={sharePointAuthPrompt}
        onOpenBrowser={() => openAuthenticationPage()}
        onDismiss={dismissAuthentication}
      />}
      <StatusBar
        document={activeTab?.document ?? null}
        autoReload={autoReload}
        onAutoReloadChange={updateAutoReload}
        zoom={viewMode === "presentation" && activeTab?.kind !== "settings" ? 100 : zoom}
        onZoomChange={viewMode === "presentation" && activeTab?.kind !== "settings" ? undefined : updateZoom}
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
        onOpenEditingTests={() => setEditingTestReportOpen(true)}
        statusText={activeTab?.kind === "settings" ? "アプリケーション設定" : undefined}
        linkTarget={focusedLinkTarget ?? undefined}
      />
      {contextTab && (() => {
        const tab = tabsState.tabs.find((candidate) => candidate.id === contextTab.id);
        if (!tab) return null;
        const index = tabsState.tabs.indexOf(tab);
        const close = (id: string) => { closeTab(id); setContextTab(null); };
        return <ContextMenu tab={tab} x={contextTab.x} y={contextTab.y} onDismiss={() => setContextTab(null)} onClose={() => close(tab.id)} onCloseOthers={() => { tabsState.tabs.filter((candidate) => candidate.id !== tab.id).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onCloseRight={() => { tabsState.tabs.slice(index + 1).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onRename={() => renameTab(tab.id)} onNewWindow={tab.untitled ? undefined : () => openInNewWindow(tab.path)} onResult={(message) => setToast({ id: String(Date.now()), message, type: "success" })} onError={(message) => setToast({ id: String(Date.now()), message, type: "error" })} />;
      })()}
      {previewContext && <PreviewContextMenu
        x={previewContext.x}
        y={previewContext.y}
        plainText={previewContext.plainText}
        markdownText={previewContext.markdownText}
        rowTsv={previewContext.rowTsv}
        canEdit={canEditActive && visualEditing}
        onEdit={editPreviewContextLine}
        onSelectLine={() => selectPreviewContent(previewContext.line)}
        onSelectRow={previewContext.rowElement ? selectPreviewRow : undefined}
        onSelectAll={() => selectPreviewContent()}
        onDismiss={() => setPreviewContext(null)}
        onResult={(message) => setToast({ id: crypto.randomUUID(), message, type: "success" })}
        onError={(message) => setToast({ id: crypto.randomUUID(), message, type: "error" })}
      />}
    </div>
    </DocumentSaveContext.Provider>
  );
}

export default App;
