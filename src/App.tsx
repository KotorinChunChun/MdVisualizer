import { useCallback, useRef, useState } from "react";
import { HeaderBar } from "./components/HeaderBar";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { CropOverlay } from "./components/CropOverlay";
import { Toast } from "./components/Toast";
import { useMarkdownFile } from "./hooks/useMarkdownFile";
import { useCropEditor } from "./hooks/useCropEditor";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { restoreImage } from "./lib/commands";
import { ToastState } from "./types/app";
import "./styles/app.css";
import "./styles/crop.css";

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const {
    filePath,
    markdownData,
    imageVersions,
    error,
    loading,
    reload,
    updateImageVersion,
  } = useMarkdownFile(containerRef);

  const { cropTarget, startCrop, cancelCrop } = useCropEditor();

  const handleMarkdownChanged = useCallback(
    (_path: string) => {
      reload();
    },
    [reload]
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
      <HeaderBar filePath={filePath} onReload={reload} />

      <main className="preview-container" ref={containerRef}>
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon">⏳</div>
            <div className="empty-title">読み込み中...</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-icon">⚠️</div>
            <div className="empty-title">ファイルを読み込めません</div>
            <div className="empty-desc">{error}</div>
          </div>
        ) : markdownData ? (
          <MarkdownPreview
            content={markdownData.content}
            baseDir={markdownData.base_dir}
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
    </div>
  );
}

export default App;
