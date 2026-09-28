import { jsx as originalJsx, jsxs as originalJsxs, Fragment } from 'react/jsx-runtime';
export { Fragment };
// 実物のJSXを維持し、生成境界で対象属性だけを付与・判定する。
// UIを別HTMLへ書き直さない。desktopでの要素構成は元のJSXと同じ。
const desktopComponents = new Set(['TabBar', 'ContextMenu', 'ExternalActions', 'CodexPanel', 'CodexSkillSettings', 'SettingsPanel', 'EditingTestReport', 'SharePointAuthDialog']);
const desktopLabels = new Set(['新規MD', '再読込', '変更あり: 再読込']);
function render(factory: typeof originalJsx, type: any, props: any, key?: any) {
  const platform = document.body.dataset.platform ?? 'desktop';
  let targets = props?.['data-platforms'];
  const name = typeof type === 'function' ? type.name : '';
  if (desktopComponents.has(name) || props?.className === 'codex-toolbar-action' || (type === 'button' && desktopLabels.has(props?.children)) || (type === 'button' && ['編集テスト結果を開く', '設定を開く'].includes(props?.['aria-label']))) targets = 'desktop';
  if (type === 'label' && Array.isArray(props?.children) && props.children.some((child: any) => child?.props?.children === 'Auto Reload')) targets = 'desktop';
  if (targets && platform !== 'all' && !targets.split(/\s+/).includes(platform)) return null;
  let next = targets ? { ...props, 'data-platforms': targets } : props;
  if (type === 'div' && props?.className === 'control-group document-actions' && platform !== 'desktop') {
    const extra = [];
    const add = (label: string, supported: string) => {
      if (platform !== 'all' && !supported.split(' ').includes(platform)) return;
      extra.push(originalJsx('button', { type: 'button', 'data-platforms': supported, title: '環境固有の追加操作（実処理未接続）', onClick: () => alert(`${label}：実処理は未接続です。`), children: label }, label));
    };
    add('ZIPを保存', 'web'); add('本文のみ保存', 'web'); add('ファイル名変更', 'web'); add('下書きを削除', 'web'); add('ファイル一覧', 'spfx'); add('接続設定', 'spfx');
    if (platform === 'all' || new URLSearchParams(location.search).get('php') === '1') {
      for (const label of ['暗号化一時保管', '復号して開く', '保管データを削除']) add(label, 'web');
    }
    next = { ...next, children: [props.children, ...extra] };
  }
  return factory(type, next, key);
}
export const jsx = (type: any, props: any, key?: any) => render(originalJsx, type, props, key);
export const jsxs = (type: any, props: any, key?: any) => render(originalJsxs, type, props, key);
