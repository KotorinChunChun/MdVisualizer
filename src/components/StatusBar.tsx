import { MarkdownLoadResult } from "../types/app";
import type { ViewMode } from "../lib/viewMode";
import "../styles/status-bar.css";

export type AutoReloadMode = "on" | "off" | "manual";

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
  mermaidStatus?: string;
  mermaidErrorCount?: number;
  imageBackupAvailable?: boolean;
  changed?: boolean;
  theme?: string;
  onThemeChange?: (value: string) => void;
  /** Layout selector lives in the preview toolbar; these compatibility props remain accepted. */
  viewMode?: ViewMode;
  onViewModeChange?: (value: ViewMode) => void;
  onOpenSettings?: () => void;
  onOpenShortcutHelp?: () => void;
  onOpenEditingTests?: () => void;
  statusText?: string;
  linkTarget?: string;
}

const zoomOptions = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];

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
  mermaidStatus,
  mermaidErrorCount = 0,
  imageBackupAvailable = false,
  changed = false,
  theme = "system",
  onThemeChange,
  onOpenSettings,
  onOpenShortcutHelp,
  onOpenEditingTests,
  statusText,
  linkTarget,
}: StatusBarProps) {
  const updateAutoReload = onAutoReloadChange ?? setAutoReload;
  const updateZoom = onZoomChange ?? setZoom;
  const mermaidSummary = mermaidStatus
    ? `Mermaid: ${mermaidStatus}${mermaidErrorCount > 0 ? ` (${mermaidErrorCount}件のエラー)` : ""}`
    : mermaidErrorCount > 0
      ? `Mermaid: ${mermaidErrorCount}件のエラー`
      : undefined;

  return (
    <footer className="status-bar" aria-label="ドキュメントの状態と表示設定">
      <div className="status-bar__details" aria-live="polite">
        {linkTarget ? <span className="status-bar__link-target" title={linkTarget}>リンク先: {linkTarget}</span> : document ? <>
          <span>{document.encoding}</span>
          <span>{formatSize(document.size_bytes)}</span>
          <span>更新 {document.modified_at}</span>
          {changed && <span className="status-bar__changed">変更あり</span>}
        </> : <span>{statusText ?? "Markdownファイル未選択"}</span>}
        {!linkTarget && mermaidSummary && <span>{mermaidSummary}</span>}
        {!linkTarget && imageBackupAvailable && <span>画像バックアップあり</span>}
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
          <span>Auto Reload</span>
          <select aria-label="Auto Reload" value={autoReload} onChange={(event) => updateAutoReload?.(event.target.value as AutoReloadMode)} disabled={!updateAutoReload}>
            <option value="on">ON</option>
            <option value="manual">手動のみ</option>
            <option value="off">OFF</option>
          </select>
        </label>
        <label>
          <span>Zoom</span>
          <select aria-label="Zoom" value={zoom} onChange={(event) => updateZoom?.(Number(event.target.value))} disabled={!updateZoom}>
            {zoomOptions.map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
        <button type="button" className="status-bar__icon-button" aria-label="編集テスト結果を開く" onClick={onOpenEditingTests} disabled={!onOpenEditingTests}>検</button>
        <button type="button" className="status-bar__icon-button" aria-label="ショートカット一覧を開く" onClick={onOpenShortcutHelp} disabled={!onOpenShortcutHelp}>?</button>
        <button type="button" className="status-bar__icon-button" aria-label="設定を開く" onClick={onOpenSettings} disabled={!onOpenSettings}>⚙</button>
      </div>
    </footer>
  );
}
