import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HeaderBar } from "./components/HeaderBar";
import { TabBar } from "./components/TabBar";
import { ContextMenu } from "./components/ContextMenu";
import { StatusBar } from "./components/StatusBar";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { CropOverlay } from "./components/CropOverlay";
import { Toast } from "./components/Toast";
import { SearchBar } from "./components/SearchBar";
import { useCropEditor } from "./hooks/useCropEditor";
import { useSearch } from "./hooks/useSearch";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { getInitialFiles, loadMarkdown, loadSettings, openContainingFolder, openInEditor, openInNewWindow, removeWindowWatchTargets, restoreImage, saveSettings, syncWatchTargets } from "./lib/commands";
import { ToastState } from "./types/app";
import { initialTabsState, tabsReducer } from "./state/tabsReducer";
import "./styles/app.css";
import "./styles/crop.css";
import "./styles/themes.css";

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightLoads = useRef(new Set<string>());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [theme, setTheme] = useState("dark");
  const [zoom, setZoom] = useState(100);
  const [viewMode, setViewMode] = useState("standard");
  const [autoReload, setAutoReload] = useState<"on" | "off" | "manual">("on");
  const [foldStates, setFoldStates] = useState<Record<string, Record<string, boolean>>>({});
  const [mermaidMode, setMermaidMode] = useState<"on" | "off" | "error-code" | "always-code">("on");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hasExternalChange, setHasExternalChange] = useState(false);
  const windowLabel = getCurrentWindow().label;

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
    void loadSettings().then((settings) => {
      if (typeof settings.theme === "string") setTheme(settings.theme);
      if (typeof settings.zoom === "number") setZoom(settings.zoom);
      if (typeof settings.viewMode === "string") setViewMode(settings.viewMode);
      if (["on", "off", "manual"].includes(String(settings.autoReload))) setAutoReload(settings.autoReload as "on" | "off" | "manual");
      else if (typeof settings.autoReload === "boolean") setAutoReload(settings.autoReload ? "on" : "off");
      if (settings.foldStates && typeof settings.foldStates === "object") setFoldStates(settings.foldStates as Record<string, Record<string, boolean>>);
      if (["on", "off", "error-code", "always-code"].includes(String(settings.mermaidMode))) setMermaidMode(settings.mermaidMode as typeof mermaidMode);
    }).catch((error) => setToast({ id: String(Date.now()), message: `設定の読込に失敗しました: ${String(error)}`, type: "error" })).finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    void saveSettings({ theme, zoom, viewMode, autoReload, foldStates, mermaidMode }).catch((error) => setToast({ id: String(Date.now()), message: `設定の保存に失敗しました: ${String(error)}`, type: "error" }));
  }, [settingsLoaded, theme, zoom, viewMode, autoReload, foldStates, mermaidMode]);
  const [contextTab, setContextTab] = useState<{ id: string; x: number; y: number } | null>(null);
  const [closedPaths, setClosedPaths] = useState<string[]>([]);
  const [tabsState, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [imageVersions, setImageVersions] = useState<Record<string, number>>({});
  const search = useSearch(markdownRef, `${windowLabel}-${tabsState.activeId ?? "empty"}`);
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeId) ?? null;

  useEffect(() => {
    if (!containerRef.current || !activeTab) return;
    const frame = window.requestAnimationFrame(() => { if (containerRef.current) containerRef.current.scrollTop = activeTab.scrollTop; });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab?.id, activeTab?.document?.path]);

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

  useEffect(() => {
    const targets = tabsState.tabs.flatMap((tab) => tab.document ? [tab.document.path, ...tab.document.image_paths] : []);
    if (autoReload !== "off" && targets.length > 0) void syncWatchTargets(windowLabel, targets);
    if (autoReload === "off") void removeWindowWatchTargets(windowLabel);
  }, [tabsState.tabs, autoReload, windowLabel]);

  useEffect(() => () => { void removeWindowWatchTargets(windowLabel); }, [windowLabel]);

  const reload = useCallback(() => {
    if (activeTab) { dispatch({ type: "RELOAD", id: activeTab.id }); setHasExternalChange(false); }
  }, [activeTab]);

  const foldAll = useCallback((command: "collapse" | "expand") => {
    window.dispatchEvent(new CustomEvent("markdown-fold-command", { detail: command }));
  }, []);

  const handleFoldChange = useCallback((foldId: string, collapsed: boolean) => {
    if (!activeTab || !foldId) return;
    setFoldStates((current) => ({ ...current, [activeTab.path]: { ...current[activeTab.path], [foldId]: collapsed } }));
  }, [activeTab]);

  const openActiveWith = useCallback((kind: "folder" | "vscode" | "notepad") => {
    if (!activeTab) return;
    const operation = kind === "folder" ? openContainingFolder(activeTab.path) : openInEditor(activeTab.path, kind);
    void operation.catch((error) => setToast({ id: String(Date.now()), message: String(error), type: "error" }));
  }, [activeTab]);

  const closeTab = useCallback((id: string) => {
    const tab = tabsState.tabs.find((candidate) => candidate.id === id);
    if (tab) setClosedPaths((previous) => [tab.path, ...previous].slice(0, 50));
    dispatch({ type: "CLOSE", id });
  }, [tabsState.tabs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "t") {
        const [path, ...remaining] = closedPaths;
        if (path) { event.preventDefault(); setClosedPaths(remaining); dispatch({ type: "OPEN", path }); }
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
        foldAll("collapse");
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && document.activeElement === searchInputRef.current) {
        event.preventDefault();
        search.clear();
        searchInputRef.current?.blur();
        return;
      }

      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((current) => Math.min(200, current + 10));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom((current) => Math.max(50, current - 10));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(100);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closedPaths, foldAll, reload, search]);

  const updateImageVersion = useCallback((imgPath: string) => {
    setImageVersions((previous) => ({ ...previous, [imgPath]: (previous[imgPath] || 0) + 1 }));
  }, []);

  const { cropTarget, startCrop, cancelCrop } = useCropEditor();

  const handleMarkdownChanged = useCallback(
    (path: string) => {
      const tab = tabsState.tabs.find((candidate) => candidate.path === path);
      if (!tab) return;
      if (autoReload === "on") dispatch({ type: "RELOAD", id: tab.id });
      else setHasExternalChange(true);
    },
    [tabsState.tabs, autoReload]
  );

  const handleImageChanged = useCallback(
    (imgPath: string) => {
      updateImageVersion(imgPath);
    },
    [updateImageVersion]
  );

  useTauriEvents(handleMarkdownChanged, handleImageChanged);

  const handleCropApply = (filename: string, backupAvailable: boolean) => {
    cancelCrop();
    if (cropTarget) {
      updateImageVersion(cropTarget.fullPath);
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
      <HeaderBar filePath={activeTab?.path ?? null} onReload={reload} />
      <div className="view-controls">
        <span className="fold-controls" aria-label="見出しの折りたたみ">
          <button type="button" onClick={() => foldAll("collapse")}>Fold all</button>
          <button type="button" onClick={() => foldAll("expand")}>Unfold all</button>
        </span>
        <label>Theme: <select value={theme} onChange={(e) => setTheme(e.target.value)}>{["system", "dark", "light", "github", "solarized", "nord"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>View: <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}>{["standard", "wide", "compact", "print", "presentation", "images"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Zoom: <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[50, 67, 80, 90, 100, 110, 125, 150, 175, 200].map((x) => <option key={x} value={x}>{x}%</option>)}</select></label>
        <label>Auto reload: <select value={autoReload} onChange={(event) => setAutoReload(event.target.value as typeof autoReload)}><option value="on">ON</option><option value="manual">手動のみ</option><option value="off">OFF</option></select></label>
        <label>Mermaid: <select value={mermaidMode} onChange={(event) => setMermaidMode(event.target.value as typeof mermaidMode)}><option value="on">ON</option><option value="off">OFF</option><option value="error-code">エラー時コード</option><option value="always-code">常にコード</option></select></label>
        <span className="external-actions"><button type="button" disabled={!activeTab} onClick={() => openActiveWith("folder")}>フォルダを開く</button><button type="button" disabled={!activeTab} onClick={() => openActiveWith("vscode")}>VS Code</button><button type="button" disabled={!activeTab} onClick={() => openActiveWith("notepad")}>メモ帳</button></span>
        {autoReload === "manual" && hasExternalChange && <button type="button" className="pending-reload" onClick={reload}>変更あり: 再読み込み</button>}
        <SearchBar search={search} inputRef={searchInputRef} />
      </div>

      <main className={`preview-container view-${viewMode}`} ref={containerRef} onScroll={(event) => { if (activeTab) dispatch({ type: "SCROLL", id: activeTab.id, scrollTop: event.currentTarget.scrollTop }); }} style={{ zoom: zoom / 100 }}>
        {activeTab?.loading ? (
          <div className="empty-state">
            <div className="empty-icon">⏳</div>
            <div className="empty-title">読み込み中...</div>
          </div>
        ) : activeTab?.error ? (
          <div className="empty-state">
            <div className="empty-icon">⚠️</div>
            <div className="empty-title">ファイルを読み込めません</div>
            <div className="empty-desc">{activeTab.error}</div>
          </div>
        ) : activeTab?.document ? (
          <MarkdownPreview
            content={activeTab.document.content}
            baseDir={activeTab.document.base_dir}
            imageVersions={imageVersions}
            onStartCrop={startCrop}
            contentRef={markdownRef}
            theme={theme === "system" ? document.documentElement.dataset.theme ?? "dark" : theme}
            onError={(message) => setToast({ id: String(Date.now()), message, type: "error" })}
            foldState={foldStates[activeTab.path]}
            onFoldChange={handleFoldChange}
            mermaidMode={mermaidMode}
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
      <StatusBar document={activeTab?.document ?? null} autoReload={autoReload} zoom={zoom} changed={hasExternalChange} />
      {contextTab && (() => {
        const tab = tabsState.tabs.find((candidate) => candidate.id === contextTab.id);
        if (!tab) return null;
        const index = tabsState.tabs.indexOf(tab);
        const close = (id: string) => { closeTab(id); setContextTab(null); };
        return <ContextMenu tab={tab} x={contextTab.x} y={contextTab.y} onClose={() => close(tab.id)} onCloseOthers={() => { tabsState.tabs.filter((candidate) => candidate.id !== tab.id).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onCloseRight={() => { tabsState.tabs.slice(index + 1).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onNewWindow={() => { void openInNewWindow(tab.path); setContextTab(null); }} onError={(message) => setToast({ id: String(Date.now()), message, type: "error" })} />;
      })()}
    </div>
  );
}

export default App;
