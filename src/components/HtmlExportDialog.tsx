import { useId, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { HtmlExportMode } from '../lib/htmlExport';

export interface HtmlExportDialogSubmit { mode: HtmlExportMode; filename: string }

export function HtmlExportDialog({ onCancel, onExport, progress, running = false, defaultFilename = 'document.html' }: {
  onCancel: () => void;
  onExport: (request: HtmlExportDialogSubmit) => void | Promise<void>;
  progress?: string;
  running?: boolean;
  defaultFilename?: string;
}) {
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLElement>(true, onCancel);
  const [mode, setMode] = useState<HtmlExportMode>('static');
  const [filename, setFilename] = useState(defaultFilename);
  const submit = async () => { if (!running && filename.trim()) await onExport({ mode, filename: filename.trim() }); };
  return <div className="html-export-backdrop" role="presentation">
    <section ref={dialogRef} className="html-export-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId}>HTML出力</h2>
      <label>ファイル名<input aria-label="ファイル名" value={filename} disabled={running} onChange={(event) => setFilename(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} /></label>
      <fieldset disabled={running}><legend>出力形式</legend>
        <label><input type="radio" name="html-export-mode" checked={mode === 'static'} onChange={() => setMode('static')} />スクリプトなし</label>
        <p>閲覧専用の単一HTMLです。</p>
        <label><input type="radio" name="html-export-mode" checked={mode === 'interactive'} onChange={() => setMode('interactive')} />スクリプトあり</label>
        <p>コピー、目次、図の拡大、表の検索と並べ替えが使えます。</p>
      </fieldset>
      {running && <output role="status" aria-live="polite">{progress || 'HTMLを出力しています'}</output>}
      <footer><button type="button" onClick={onCancel}>{running ? '中止' : 'キャンセル'}</button><button type="button" className="primary" disabled={running || !filename.trim()} onClick={() => void submit()}>HTMLを出力</button></footer>
    </section>
  </div>;
}
