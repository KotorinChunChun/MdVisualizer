import type { PrintStyleSettings } from "../lib/printStyle";

export function PrintMetadata({ path, startedAt, settings }: {
  path: string;
  startedAt: Date | null;
  settings: PrintStyleSettings;
}) {
  if (!settings.showTitle && !settings.showFilename && !(settings.showDate && startedAt)) return null;
  return <div className="print-metadata" aria-hidden="true">
    {settings.showTitle && <strong>{path.split(/[\\/]/).pop() ?? path}</strong>}
    {settings.showFilename && <span>元ファイル: {path}</span>}
    {settings.showDate && startedAt && <time dateTime={startedAt.toISOString()}>印刷日時: {startedAt.toLocaleString("ja-JP")}</time>}
  </div>;
}
