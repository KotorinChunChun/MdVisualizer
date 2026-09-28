import { jsx as originalJsx, jsxs as originalJsxs, Fragment } from 'react/jsx-runtime';
import { Children, isValidElement } from 'react';
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
  if (type === 'div' && props?.className === 'view-controls' && platform !== 'desktop') {
    const extra = [];
    const group = (title: string, supported: string, labels: string[]) => {
      if (platform !== 'all' && platform !== supported) return;
      extra.push(originalJsxs('div', { className: 'control-group document-actions', 'data-platforms': supported, 'data-host-group': title, role: 'group', 'aria-label': title, children: [
        originalJsx('span', { className: 'control-group__title', children: title }),
        ...labels.map(label => originalJsx('button', { type: 'button', title: '外見試作：実処理未接続', onClick: () => alert(`${label}：実処理は未接続です。`), children: label }, label)),
      ] }, title));
    };
    group('ブラウザー保存', 'web', ['ZIPを保存', '本文のみ保存', 'ファイル名変更', '下書きを削除']);
    group('SharePoint', 'spfx', ['ファイル一覧', '接続設定']);
    if (platform === 'all' || new URLSearchParams(location.search).get('php') === '1') group('暗号化一時保管', 'web', ['一時保管', '復号して開く', '保管データを削除']);
    next = { ...next, children: [props.children, ...extra] };
  }
  if (platform !== 'desktop' && typeof type === 'string' && /control-group|workspace-view-controls|status-bar__controls/.test(props?.className ?? '')) {
    const children = Children.toArray(next.children);
    const separator = (child: any) => isValidElement(child) && ((child.props as any).role === 'separator');
    const cleaned = children.filter((child, index) => !separator(child) || (index > 0 && index < children.length - 1 && !separator(children[index - 1])));
    // 見出しだけの空グループを残さない。Desktopでは元の出力を一切再配置しない。
    if (!cleaned.some(child => isValidElement(child) && (child.props as any).className !== 'control-group__title')) return null;
    next = { ...next, children: cleaned };
  }
  return factory(type, next, key);
}
export const jsx = (type: any, props: any, key?: any) => render(originalJsx, type, props, key);
export const jsxs = (type: any, props: any, key?: any) => render(originalJsxs, type, props, key);
