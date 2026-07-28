import { MarkdownLoadResult } from "../types/app";
import { getFileName } from "../lib/path";

export function StatusBar({ document }: { document: MarkdownLoadResult | null }) {
  if (!document) return <footer className="status-bar">Markdownファイル未選択</footer>;
  const size = document.size_bytes < 1024 ? `${document.size_bytes} B` : `${(document.size_bytes / 1024).toFixed(1)} KB`;
  return <footer className="status-bar">{getFileName(document.path)}　|　{document.encoding}　|　{size}　|　Modified {document.modified_at}</footer>;
}
