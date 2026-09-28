import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceViewControls, type PreviewMode, type SplitDirection, type InteractionMode } from '../../../web-platform/packages/editor-ui/src/components/WorkspaceViewControls';
import { StatusBar } from '../../../src/components/StatusBar';
import { DocumentSidePanel, type DocumentSidePanelTab } from '../../../src/components/DocumentSidePanel';
import '../../../web-platform/packages/editor-ui/src/styles/app.css';
import '../../../web-platform/packages/editor-ui/src/styles/content.css';
import '../../../web-platform/packages/editor-ui/src/styles/themes.css';
import './shell.css';

// 外見の検討用。実際の対応能力・権限は製品接続時にアダプターから渡す。
const profiles = {
  desktop: { label: 'デスクトップ', storage: 'ローカルファイル', ai: true, external: true, reload: true },
  web: { label: 'Webブラウザー', storage: 'ダウンロード / PHP', ai: false, external: false, reload: false },
  spfx: { label: 'SPFx', storage: 'SharePoint ドキュメント', ai: false, external: false, reload: true },
} as const;
type Host = keyof typeof profiles;
const sample = '# プロジェクトノート\n\nチームで文書を育てるためのワークスペース。\n\n## 今週の予定\n\n- 要件を整理する\n- 画面を確認する\n- レビューを共有する\n\n## 進捗\n\n| 作業 | 状態 |\n| --- | --- |\n| 要件整理 | 完了 |\n| UI検討 | 確認中 |\n\n## フロー\n\n```mermaid\ngraph LR\n  A[作成] --> B[確認] --> C[共有]\n```';
function Shell() {
  const initial = document.body.dataset.initialHost;
  const [host, setHost] = useState<Host>(initial && initial in profiles ? initial as Host : 'desktop');
  const [code, setCode] = useState(true), [preview, setPreview] = useState<PreviewMode>('preview');
  const [direction, setDirection] = useState<SplitDirection>('horizontal');
  const [interaction, setInteraction] = useState<InteractionMode>('browse');
  const [theme, setTheme] = useState('light'), [zoom, setZoom] = useState(100);
  const [panel, setPanel] = useState<DocumentSidePanelTab | null>(null);
  const [readOnly, setReadOnly] = useState(false), [aiOpen, setAiOpen] = useState(false);
  const [width, setWidth] = useState('full'), [layout, setLayout] = useState('auto');
  const [message, setMessage] = useState(''), [diff, setDiff] = useState(false);
  const [dialog, setDialog] = useState('');
  const capabilities = profiles[host];
  const demo = (label: string) => setMessage(`${label}：外見の試作のため実処理は接続していません。`);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { if (readOnly) setInteraction('browse'); }, [readOnly]);
  const button = (label: string, disabled = false) => <button key={label} type="button" disabled={disabled} onClick={() => demo(label)}>{label}</button>;
  return <>
    <header className="prototype-controls">
      <strong>MdVisualizer <small>共通フルUI・外見試作</small></strong>
      <label>環境 <select aria-label="環境" value={host} onChange={e => { setHost(e.target.value as Host); setAiOpen(false); }}>{Object.entries(profiles).map(([id, profile]) => <option key={id} value={id}>{profile.label}</option>)}</select></label>
      <label>画面幅 <select aria-label="画面幅" value={width} onChange={e => setWidth(e.target.value)}><option value="full">全幅</option><option value="960">960px</option><option value="390">390px</option></select></label>
      <label><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} /> 閲覧権限のみ</label>
      <span className="profile-storage">{capabilities.storage}</span>
    </header>
    <main className="prototype-stage">
      <div className="prototype-frame" style={{ width: width === 'full' ? '100%' : `${width}px` }}>
        <section className="app-container prototype-shell" aria-label={`${capabilities.label}の共通UI`}>
          <nav className="tab-bar" aria-label="開いている文書"><div className="tab active"><span className="tab__label">プロジェクトノート.md</span><button aria-label="文書を閉じる" onClick={() => demo('閉じる')}>×</button></div><span className="prototype-document-state">{readOnly ? '閲覧のみ' : 'UTF-8'}</span></nav>
          <div className="view-controls" aria-label="表示と文書の操作">
            <div className="control-group document-actions">{button('新規MD', readOnly)}{button('開く')}{button('印刷')}{button('HTML出力')}{button('診断')}{capabilities.reload && button('再読込')}{button('保存', readOnly)}</div>
            <div className="control-group editor-mode-controls"><WorkspaceViewControls code={code} preview={preview} direction={direction} onDirectionChange={setDirection} interactionMode={interaction} onInteractionModeChange={value => { if (!readOnly) setInteraction(value); else demo('編集権限がありません'); }} onChange={(nextCode, nextPreview) => { setCode(nextCode); setPreview(nextPreview); }} betweenPreviewAndDirection={<button aria-pressed={diff} onClick={() => setDiff(!diff)}>差分</button>} /></div>
            {capabilities.external && <div className="control-group">{button('外部アプリ')}{button('別ウィンドウ')}</div>}
            {capabilities.ai && <button className="codex-toolbar-action" aria-expanded={aiOpen} onClick={() => setAiOpen(!aiOpen)}>AI</button>}
          </div>
          <div className="prototype-body">
            <DocumentSidePanel activeTab={panel} onTabChange={setPanel} onClose={() => setPanel(null)} toc={<div className="prototype-toc">{['プロジェクトノート', '今週の予定', '進捗', 'フロー'].map((name, i) => <button key={name} onClick={() => document.getElementById(`section-${i}`)?.scrollIntoView({ block: 'nearest' })}>{name}</button>)}</div>} search={<label>文書内検索<input aria-label="文書内検索" placeholder="検索語を入力" onChange={() => demo('検索')} /></label>} images={<p>このサンプルに画像はありません。</p>} />
            <div className={`prototype-panes direction-${direction}`}>
              {code && <section className="prototype-code" aria-label="コード領域"><div className="prototype-pane-bar">Markdown <span>コード</span></div><div className="prototype-format">{['見出し', '太字', 'リンク', '表', '図', '画像'].map(label => button(label, readOnly || interaction === 'browse'))}</div><textarea aria-label="サンプルMarkdown" value={sample} readOnly spellCheck={false} /></section>}
              {preview !== 'off' && <section className="prototype-preview" aria-label="プレビュー領域"><div className="prototype-pane-bar"><label>見出し <select aria-label="見出し表示" onChange={() => demo('見出し表示')}><option>すべて展開</option><option>すべて折りたたむ</option></select></label><label>レイアウト <select aria-label="レイアウト" value={layout} onChange={e => setLayout(e.target.value)}><option value="auto">自動</option><option value="a4">A4縦</option></select></label></div>
                <div className={`prototype-page layout-${layout}`}><article className="markdown-body" style={{ fontSize: `${zoom}%` }}>
                  {diff && <div className="prototype-diff">差分表示のサンプル：＋ レビューを共有する</div>}
                  <h1 id="section-0">プロジェクトノート</h1><p>チームで文書を育てるためのワークスペース。</p>
                  <h2 id="section-1">今週の予定</h2><ul><li>要件を整理する</li><li>画面を確認する</li><li>レビューを共有する</li></ul>
                  <h2 id="section-2">進捗</h2><div className="prototype-block-menu">{button('コピー')}{button('編集', readOnly)}{button('⋯')}</div><table><thead><tr><th>作業</th><th>状態</th></tr></thead><tbody><tr><td>要件整理</td><td>完了</td></tr><tr><td>UI検討</td><td>確認中</td></tr></tbody></table>
                  <h2 id="section-3">フロー</h2><div className="prototype-flow" aria-label="作成から確認、共有へ"><span>作成</span><b>→</b><span>確認</span><b>→</b><span>共有</span></div>
                  <blockquote>同じ画面を、環境に応じた機能で利用します。</blockquote>
                </article></div>
              </section>}
            </div>
            {capabilities.ai && aiOpen && <aside className="prototype-ai"><strong>AI</strong><p>この文書について相談</p><textarea aria-label="AIへの相談" placeholder="相談内容を入力" /><button onClick={() => demo('AI送信')}>送信</button></aside>}
          </div>
          <StatusBar document={null} statusText={readOnly ? '閲覧のみ' : 'プロジェクトノート.md · UTF-8'} theme={theme} onThemeChange={setTheme} zoom={zoom} onZoomChange={setZoom} onAutoReloadChange={capabilities.reload ? () => demo('Auto Reload') : undefined} onOpenSettings={() => setDialog('設定')} onOpenShortcutHelp={() => setDialog('ショートカット一覧')} />
        </section>
      </div>
    </main>
    {message && <output className="prototype-toast" role="status">{message}</output>}
    {dialog && <div className="prototype-modal" onKeyDown={e => { if (e.key === 'Escape') setDialog(''); }}><section role="dialog" aria-modal="true" aria-label={dialog}><h2>{dialog}</h2><p>外見の確認用です。設定やファイルは変更しません。</p><button autoFocus onClick={() => setDialog('')}>閉じる</button></section></div>}
  </>;
}
createRoot(document.getElementById('root')!).render(<Shell />);
