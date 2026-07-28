import { MarkdownLoadResult } from "../types/app";
import { getFileName } from "../lib/path";

export function StatusBar({ document, autoReload, zoom, changed }: { document: MarkdownLoadResult | null; autoReload: "on" | "off" | "manual"; zoom: number; changed: boolean }) {
  if (!document) return <footer className="status-bar">Markdownファイル未選択</footer>;
  const size = document.size_bytes < 1024 ? `${document.size_bytes} B` : `${(document.size_bytes / 1024).toFixed(1)} KB`;
  const reloadStatus = autoReload === "on" ? "Auto Reload ON" : autoReload === "manual" ? "Auto Reload 手動のみ" : "Auto Reload OFF";
  return <footer className="status-bar">{getFileName(document.path)}　|　{document.encoding}　|　{size}　|　Modified {document.modified_at}　|　{reloadStatus}　|　{zoom}%{changed ? "　|　変更あり" : ""}</footer>;
}
