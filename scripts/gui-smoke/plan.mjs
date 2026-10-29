// シナリオを追加するときは依存と変更パスの規則を併せて更新する。
export const scenarios = [
  { id: 'connect', label: '専用WebViewへ接続', kind: 'setup', requires: [] },
  { id: 'document', label: '専用文書を選択して閲覧へ戻す', kind: 'setup', requires: ['connect'] },
  ...[
    ['view-context', '閲覧メニューと編集への移動'],
    ['structured-list', '入れ子リスト'],
    ['mermaid', 'Mermaidの表示と拡大'],
    ['drawio', 'draw.ioの表示と拡大'],
    ['diff', 'Diffの表示・モード切替・同期・終了'],
  ].map(([id, label]) => ({ id, label, kind: 'automated', requires: ['document'] })),
  { id: 'native-prepare', label: '専用プロセス・設定・入力先の準備', kind: 'manual', requires: [] },
  ...[
    ['received-url', '起動・再受信したURLの表示'],
    ['url-copy', '受信URLとOSクリップボードの一致'],
    ['open-shortcut', 'Ctrl+OとOSファイル選択'],
    ['save-shortcut', 'Ctrl+Sと保存ファイル'],
    ['shortcut-tooltips', 'ボタンのショートカットツールチップ'],
    ['settings-errors', '設定エラーの背景・文字色'],
    ['wiki-open', '実テナントの認証・Wiki文書取得'],
  ].map(([id, label]) => ({ id, label, kind: 'manual', requires: id === 'url-copy' ? ['received-url'] : ['native-prepare'] })),
];
const automatic = scenarios.filter(s => s.kind === 'automated').map(s => s.id);
const native = scenarios.filter(s => s.kind === 'manual' && s.id !== 'native-prepare').map(s => s.id);

// 正本とDesktop投影を同じパスへ正規化する。未知のパスは自動省略しない。
export function normalizeChangedPath(value) {
  let file = value.replaceAll('\\', '/').replace(/^\.\//, '');
  file = file.replace(/^web-platform\/packages\/editor-ui\/src\//, 'src/');
  if (!file || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) {
    throw new Error(`変更パスはリポジトリ相対で指定してください: ${value}`);
  }
  return file;
}

const rules = [
  { match: /^(docs\/|dev\/history\/|README\.md$)/, ids: [], reason: '文書のみ。リンク・差分を検査する' },
  { match: /^scripts\/(gui-smoke\/|gui-smoke-manual\.mjs$|debug-preview-smoke\.mjs$|test-gui-smoke\.mjs$|run-debug-MdVisualizer-all-smoke\.ps1$)/, ids: [], reason: 'GUI検証基盤のみ。test:gui-smokeで分岐・計測・実行契約を検査する' },
  { match: /^src\/App\.tsx$|^src-tauri\/src\/lib\.rs$|^(package(-lock)?\.json|vitest\.config\.|src\/styles\/(app|index|theme))/, ids: [...automatic, ...native], reason: '横断的な起動・状態・依存・表示への影響' },
  { match: /^(src-tauri\/src\/(sharepoint([/.]|$)|received_uri\.rs)|src\/(components\/SharePointSettings|lib\/sharePoint))/, ids: ['received-url', 'url-copy', 'settings-errors', 'wiki-open'], reason: 'SharePointの受信・診断・コピー・取得への影響' },
  { match: /^src\/(components\/SettingsPanel|styles\/settings\.css)/, ids: ['received-url', 'url-copy', 'save-shortcut', 'settings-errors'], reason: '設定画面と設定保存への影響' },
  { match: /^src\/hooks\/useDocumentOpenShortcut/, ids: ['open-shortcut', 'shortcut-tooltips'], reason: 'OSファイル選択とキー操作への影響' },
  { match: /^src\/.*(DocumentDiff|documentDiff|document-diff)/i, ids: ['diff'], reason: 'Diffへの影響' },
  { match: /^src\/.*(Mermaid|mermaid)/, ids: ['mermaid', 'diff'], reason: 'MermaidとDiff内の図表示への影響' },
  { match: /^src\/.*(Drawio|drawio)/, ids: ['drawio', 'diff'], reason: 'draw.ioとDiff内の図表示への影響' },
  { match: /^src\/.*(PreviewContext|preview-context|usePreviewContext)/, ids: ['view-context'], reason: '閲覧メニューへの影響' },
  { match: /^web-platform\/packages\/markdown-core\//, ids: automatic, reason: '共有Markdown処理。各ホストの関連テストも別途選択する' },
  { match: /^src\/.*(MarkdownPreview|markdown-body|markdownBody|markdown-render|listMarker)/, ids: automatic, reason: 'Markdown表示全体への影響' },
  { match: /^src-tauri\/src\/(file|document|settings|encoding|path)/, ids: ['open-shortcut', 'save-shortcut'], reason: 'ファイル・設定・パス境界への影響' },
];

export function createPlan({ selected = [], changed = [] } = {}) {
  if (selected.length && changed.length) throw new Error('個別指定と変更パスによる選択は同時に使えません。');
  const reasons = new Map();
  const decisions = [];
  const reviewRequired = [];
  function include(id, reason) {
    const scenario = scenarios.find(s => s.id === id);
    if (!scenario) throw new Error(`未知のシナリオです: ${id}`);
    const current = reasons.get(id) ?? [];
    if (current.includes(reason)) return;
    reasons.set(id, [...current, reason]);
    for (const dependency of scenario.requires) include(dependency, `${id}の前提`);
  }
  if (selected.length) {
    for (const id of selected) {
      if (id === 'all') for (const item of automatic) include(item, '従来の一括WebView検証を明示選択');
      else include(id, '個別指定');
    }
  } else if (changed.length) {
    for (const value of changed) {
      const file = normalizeChangedPath(value);
      const matches = rules.filter(rule => rule.match.test(file));
      if (!matches.length) {
        reviewRequired.push(file);
        decisions.push({ file, status: 'review-required', reason: '登録外の変更。影響を判断してシナリオを明示選択する' });
      } else {
        for (const rule of matches) for (const id of rule.ids) include(id, `${file}: ${rule.reason}`);
        decisions.push({ file, status: matches.some(rule => rule.ids.length) ? 'selected' : 'not-required', reasons: matches.map(rule => rule.reason) });
      }
    }
  } else {
    for (const id of automatic) include(id, '従来の一括WebView検証（指定なし）');
  }
  const steps = scenarios.map(s => ({ ...s, status: reasons.has(s.id) ? 'not-run' : 'excluded', reasons: reasons.get(s.id) ?? ['今回の選択範囲外'] }));
  return { schemaVersion: 1, mode: selected.length ? 'explicit' : changed.length ? 'changed' : 'legacy-all', decisions, reviewRequired, steps };
}
