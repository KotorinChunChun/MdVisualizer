import { useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { HtmlExportDialog, type HtmlExportDialogSubmit } from './HtmlExportDialog';
import { exportHtmlInBrowser, type HtmlExportAsset } from '../lib/htmlExport';
import { readDocumentAsset } from '../lib/commands';
import type { MarkdownLoadResult, StagedDocumentAsset } from '../types/app';
import '../styles/html-export.css';

export interface DesktopExportSnapshot { document: MarkdownLoadResult; content: string; theme: string; css: string; assets: StagedDocumentAsset[] }
const dirname = (path: string) => path.replace(/\\/g, '/').replace(/[^/]*$/, '');

function resolveAssetPath(source: string, base: string, rootBase: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    const resolved = new URL(source, base.endsWith('/') ? base : `${base}/`).href;
    if (!resolved.toLowerCase().startsWith(rootBase.toLowerCase())) throw new Error('文書フォルダー外の資産は出力できません。');
    return resolved;
  }
  const candidate = (/^[A-Za-z]:\//.test(source) || source.startsWith('/') ? source : `${base.replace(/\/?$/, '/')}${source}`).replace(/\\/g, '/');
  const parts: string[] = [];
  for (const part of candidate.split('/')) { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part); }
  const resolved = parts.join('/');
  if (!resolved.toLowerCase().startsWith(rootBase.toLowerCase())) throw new Error('文書フォルダー外の資産は出力できません。');
  return resolved;
}

export function exportDocumentMarkdown(document: MarkdownLoadResult, content: string): string {
  if (document.kind === 'markdown') return content;
  const fence = '`'.repeat(Math.max(3, ...Array.from(content.matchAll(/`+/g), match => match[0].length + 1)));
  return `${fence}${document.kind === 'svg' ? 'svg' : document.kind}\n${content}\n${fence}`;
}

export function DesktopHtmlExport({ disabled, getSnapshot }: { disabled: boolean; getSnapshot: () => DesktopExportSnapshot | null }) {
  const [snapshot, setSnapshot] = useState<DesktopExportSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const notify = (type: string, message: string) => window.dispatchEvent(new CustomEvent('markdown-toast', { detail: { type, message } }));
  const execute = async ({ mode, filename }: HtmlExportDialogSubmit) => {
    if (!snapshot || busy.current) return;
    busy.current = true; setRunning(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const target = await save({ defaultPath: filename.toLowerCase().endsWith('.html') ? filename : `${filename}.html`, filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
      if (!target || abort.signal.aborted) return;
      const rootBase = snapshot.document.base_dir.replace(/\\/g, '/').replace(/\/?$/, '/');
      const readAsset = async (source: string, base = rootBase): Promise<HtmlExportAsset> => {
        abort.signal.throwIfAborted();
        if (/^(data:|blob:|https?:\/\/)/i.test(source)) {
          const response = await fetch(source, { signal: abort.signal, credentials: 'omit' });
          if (!response.ok) throw new Error('画像・図の取得に失敗しました。');
          const blob = await response.blob();
          if (blob.size > 32 * 1024 * 1024) throw new Error('画像・図が容量上限を超えています。');
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
          return { base: /^https?:/i.test(source) ? new URL('.', response.url || source).href : base, mime: blob.type, data, text: /^text\/|svg|xml|json/.test(blob.type) ? await blob.text() : undefined };
        }
        let decoded: string;
        try { decoded = decodeURIComponent(source.split(/[?#]/)[0]); } catch { throw new Error('資産の参照パスが不正です。'); }
        const full = resolveAssetPath(decoded, base, rootBase);
        const relative = full.slice(rootBase.length);
        const staged = snapshot.assets.find(asset => asset.filename.replace(/\\/g, '/') === relative);
        if (staged) {
          const mime = staged.mediaType || (/\.svg$/i.test(relative) ? 'image/svg+xml' : 'text/plain');
          const data = staged.base64 ? `data:${mime};base64,${staged.base64}` : staged.previewSource || '';
          return { base: dirname(full), mime, data, text: staged.text };
        }
        const asset = await readDocumentAsset(snapshot.document.path, relative);
        return { base: dirname(full), mime: asset.mediaType, text: asset.text ?? undefined, data: `data:${asset.mediaType};base64,${asset.base64}` };
      };
      const result = await exportHtmlInBrowser({ markdown: exportDocumentMarkdown(snapshot.document, snapshot.content), title: filename.replace(/\.html?$/i, ''), theme: snapshot.theme, css: snapshot.css, mode, baseDir: rootBase, readAsset, signal: abort.signal, onProgress: setProgress,
        drawioViewer: async () => { const response = await fetch('https://viewer.diagrams.net/js/viewer-static.min.js', { signal: abort.signal, credentials: 'omit' }); if (!response.ok) throw new Error('draw.io描画ライブラリを取得できません。'); const text = await response.text(); if (text.length > 8 * 1024 * 1024) throw new Error('draw.io描画ライブラリが上限を超えました。'); return text; },
      });
      abort.signal.throwIfAborted();
      setProgress('ファイルへ保存しています');
      await invoke('save_html_export', { path: target, html: result.html, documentPath: snapshot.document.path });
      notify('success', `HTMLを保存しました: ${target}`); setSnapshot(null);
    } catch (error) {
      notify(abort.signal.aborted ? 'info' : 'error', abort.signal.aborted ? 'HTML出力を中止しました。' : error instanceof Error ? error.message : String(error));
    } finally { busy.current = false; setRunning(false); controller.current = null; setProgress(''); }
  };
  return <>
    <button data-ui-command="document.export-html" type="button" disabled={disabled || running} onClick={() => { const next = getSnapshot(); if (next) setSnapshot({ ...next, document: { ...next.document }, assets: next.assets.map(asset => ({ ...asset })) }); }}>HTML出力</button>
    {snapshot && <HtmlExportDialog running={running} progress={progress} defaultFilename={(snapshot.document.path.split(/[\\/]/).pop() || 'document').replace(/\.[^.]+$/, '') + '.html'} onExport={execute} onCancel={() => { controller.current?.abort(); if (!running) setSnapshot(null); }} />}
  </>;
}
