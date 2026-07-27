import { useCallback, useEffect, useRef, useState } from "react";
import { getInitialFile, loadMarkdown, startWatch } from "../lib/commands";
import { MarkdownLoadResult } from "../types/app";

export function useMarkdownFile(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [markdownData, setMarkdownData] = useState<MarkdownLoadResult | null>(null);
  const [imageVersions, setImageVersions] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const scrollTopRef = useRef<number>(0);

  // 1. Markdownファイルの読み込みとスクロール維持
  const loadFile = useCallback(
    async (targetPath: string, isReload = false) => {
      try {
        if (isReload && containerRef.current) {
          scrollTopRef.current = containerRef.current.scrollTop;
        }

        const res = await loadMarkdown(targetPath);
        setMarkdownData(res);
        setFilePath(res.path);
        setError(null);

        // ファイル監視を開始
        await startWatch(res.path);

        if (isReload && containerRef.current) {
          requestAnimationFrame(() => {
            if (containerRef.current) {
              containerRef.current.scrollTop = scrollTopRef.current;
            }
          });
        }
      } catch (err) {
        console.error("Failed to load markdown:", err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [containerRef]
  );

  // 初期ファイル取得
  useEffect(() => {
    async function init() {
      try {
        const initPath = await getInitialFile();
        if (initPath) {
          await loadFile(initPath);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to get initial file:", err);
        setLoading(false);
      }
    }
    init();
  }, [loadFile]);

  // 手動リロード (F5)
  const reload = useCallback(() => {
    if (filePath) {
      loadFile(filePath, true);
    }
  }, [filePath, loadFile]);

  // キーボード F5 のリスナー
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        reload();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reload]);

  // 画像変更検知時のキャッシュバスター更新
  const updateImageVersion = useCallback((imgPath: string) => {
    setImageVersions((prev) => ({
      ...prev,
      [imgPath]: (prev[imgPath] || 0) + 1,
    }));
  }, []);

  return {
    filePath,
    markdownData,
    imageVersions,
    error,
    loading,
    loadFile,
    reload,
    updateImageVersion,
  };
}
