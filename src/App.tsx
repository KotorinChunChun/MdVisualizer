import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HeaderBar } from "./components/HeaderBar";
import { TabBar } from "./components/TabBar";
import { ContextMenu } from "./components/ContextMenu";
import { StatusBar } from "./components/StatusBar";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { CropOverlay } from "./components/CropOverlay";
import { Toast } from "./components/Toast";
import { useCropEditor } from "./hooks/useCropEditor";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { getInitialFiles, loadMarkdown, openInNewWindow, restoreImage, syncWatchTargets } from "./lib/commands";
import { ToastState } from "./types/app";
import { initialTabsState, tabsReducer } from "./state/tabsReducer";
import "./styles/app.css";
import "./styles/crop.css";

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inFlightLoads = useRef(new Set<string>());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [contextTab, setContextTab] = useState<{ id: string; x: number; y: number } | null>(null);
  const [closedPaths, setClosedPaths] = useState<string[]>([]);
  const [tabsState, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [imageVersions, setImageVersions] = useState<Record<string, number>>({});
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeId) ?? null;

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
    if (targets.length > 0) void syncWatchTargets("main", targets);
  }, [tabsState.tabs]);

  const reload = useCallback(() => {
    if (activeTab) dispatch({ type: "RELOAD", id: activeTab.id });
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closedPaths]);

  const updateImageVersion = useCallback((imgPath: string) => {
    setImageVersions((previous) => ({ ...previous, [imgPath]: (previous[imgPath] || 0) + 1 }));
  }, []);

  const { cropTarget, startCrop, cancelCrop } = useCropEditor();

  const handleMarkdownChanged = useCallback(
    (path: string) => {
      const tab = tabsState.tabs.find((candidate) => candidate.path === path);
      if (tab) dispatch({ type: "RELOAD", id: tab.id });
    },
    [tabsState.tabs]
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

      <main className="preview-container" ref={containerRef}>
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
      <StatusBar document={activeTab?.document ?? null} />
      {contextTab && (() => {
        const tab = tabsState.tabs.find((candidate) => candidate.id === contextTab.id);
        if (!tab) return null;
        const index = tabsState.tabs.indexOf(tab);
        const close = (id: string) => { closeTab(id); setContextTab(null); };
        return <ContextMenu tab={tab} x={contextTab.x} y={contextTab.y} onClose={() => close(tab.id)} onCloseOthers={() => { tabsState.tabs.filter((candidate) => candidate.id !== tab.id).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onCloseRight={() => { tabsState.tabs.slice(index + 1).forEach((candidate) => closeTab(candidate.id)); setContextTab(null); }} onNewWindow={() => { void openInNewWindow(tab.path); setContextTab(null); }} />;
      })()}
    </div>
  );
}

export default App;
