import { MarkdownLoadResult } from "../types/app";
import "../styles/status-bar.css";

export type AutoReloadMode = "on" | "off" | "manual";
export type MermaidMode = "on" | "off" | "error-code" | "always-code";

export interface StatusBarProps {
  document: MarkdownLoadResult | null;
  autoReload?: AutoReloadMode;
  /** Preferred callback name for a controlled StatusBar. */
  onAutoReloadChange?: (value: AutoReloadMode) => void;
  /** Compatibility alias for callers that keep React state setters as props. */
  setAutoReload?: (value: AutoReloadMode) => void;
  zoom?: number;
  onZoomChange?: (value: number) => void;
  setZoom?: (value: number) => void;
  mermaidMode?: MermaidMode;
  onMermaidModeChange?: (value: MermaidMode) => void;
  setMermaidMode?: (value: MermaidMode) => void;
  mermaidStatus?: string;
  mermaidErrorCount?: number;
  imageBackupAvailable?: boolean;
  changed?: boolean;
  theme?: string;
  onThemeChange?: (value: string) => void;
  viewMode?: string;
  onViewModeChange?: (value: string) => void;
}

const zoomOptions = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200];

function formatSize(sizeBytes: number) {
  return sizeBytes < 1024 ? `${sizeBytes} B` : `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export function StatusBar({
  document,
  autoReload = "on",
  onAutoReloadChange,
  setAutoReload,
  zoom = 100,
  onZoomChange,
  setZoom,
  mermaidMode = "on",
  onMermaidModeChange,
  setMermaidMode,
  mermaidStatus,
  mermaidErrorCount = 0,
  imageBackupAvailable = false,
  changed = false,
  theme = "system",
  onThemeChange,
  viewMode = "standard",
  onViewModeChange,
}: StatusBarProps) {
  const updateAutoReload = onAutoReloadChange ?? setAutoReload;
  const updateZoom = onZoomChange ?? setZoom;
  const updateMermaidMode = onMermaidModeChange ?? setMermaidMode;
  const mermaidSummary = mermaidStatus
    ? `Mermaid: ${mermaidStatus}${mermaidErrorCount > 0 ? ` (${mermaidErrorCount}件のエラー)` : ""}`
    : mermaidErrorCount > 0
      ? `Mermaid: ${mermaidErrorCount}件のエラー`
      : undefined;

  return (
    <footer className="status-bar" aria-label="ドキュメントの状態と表示設定">
      <div className="status-bar__details" aria-live="polite">
        {document ? <>
          <span>{document.encoding}</span>
          <span>{formatSize(document.size_bytes)}</span>
          <span>更新 {document.modified_at}</span>
          {changed && <span className="status-bar__changed">変更あり</span>}
        </> : <span>Markdownファイル未選択</span>}
        {mermaidSummary && <span>{mermaidSummary}</span>}
        {imageBackupAvailable && <span>画像バックアップあり</span>}
      </div>
      <div className="status-bar__controls" aria-label="表示設定">
        <label>
          <span>テーマ</span>
          <select aria-label="テーマ" value={theme} onChange={(event) => onThemeChange?.(event.target.value)} disabled={!onThemeChange}>
            <option value="system">システム</option>
            <option value="dark">ダーク</option>
            <option value="light">ライト</option>
            <option value="github">GitHub</option>
            <option value="solarized">Solarized</option>
            <option value="nord">Nord</option>
          </select>
        </label>
        <label>
          <span>レイアウト</span>
          <select aria-label="レイアウト" value={viewMode} onChange={(event) => onViewModeChange?.(event.target.value)} disabled={!onViewModeChange}>
            <option value="standard">標準</option>
            <option value="wide">ワイド</option>
            <option value="compact">コンパクト</option>
            <option value="print">印刷</option>
            <option value="presentation">プレゼン</option>
            <option value="images">画像中心</option>
          </select>
        </label>
        <label>
          <span>Auto Reload</span>
          <select aria-label="Auto Reload" value={autoReload} onChange={(event) => updateAutoReload?.(event.target.value as AutoReloadMode)} disabled={!updateAutoReload}>
            <option value="on">ON</option>
            <option value="manual">手動のみ</option>
            <option value="off">OFF</option>
          </select>
        </label>
        <label>
          <span>Mermaid</span>
          <select aria-label="Mermaid" value={mermaidMode} onChange={(event) => updateMermaidMode?.(event.target.value as MermaidMode)} disabled={!updateMermaidMode}>
            <option value="on">ON</option>
            <option value="off">OFF</option>
            <option value="error-code">エラー時コード</option>
            <option value="always-code">常にコード</option>
          </select>
        </label>
        <label>
          <span>Zoom</span>
          <select aria-label="Zoom" value={zoom} onChange={(event) => updateZoom?.(Number(event.target.value))} disabled={!updateZoom}>
            {zoomOptions.map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
      </div>
    </footer>
  );
}
