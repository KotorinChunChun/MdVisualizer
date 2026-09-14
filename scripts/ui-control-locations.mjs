import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const root = path.resolve(import.meta.dirname, '..');
const cache = new Map();
const htmlCache = new Map();
const hostNames = { desktop: 'Desktop', web: 'HTML/PHP', shared: '共通', spfx: 'SPFx' };
const names = {
  'document-actions': '文書操作ツールバー', 'web-menu-items': '文書操作ツールバー／メニュー',
  'web-options-items': '文書オプションメニュー', 'workspace-view-controls': '表示切替ツールバー',
  'markdown-editor-toolbar': 'コード編集ツールバー', 'markdown-editor-toolbar__actions': 'コード編集操作',
  'search-bar': '検索ツールバー', 'context-menu': '右クリックメニュー',
  'diagram-toolbar': '図の操作ツールバー', 'media-preview-toolbar': 'メディア操作ツールバー',
};
function attributes(node) {
  const result = {};
  for (const p of node.attributes.properties) if (ts.isJsxAttribute(p) && p.initializer && ts.isStringLiteral(p.initializer)) result[p.name.text] = p.initializer.text;
  return result;
}
function sourceNodes(file) {
  if (cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const nodes = new Map();
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) || ts.isObjectLiteralExpression(node)) {
      const p = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      nodes.set(`${p.line + 1}:${p.character + 1}`, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); const result = { ast, nodes, text }; cache.set(file, result); return result;
}
function desktopRank(key) {
  const {nodes} = sourceNodes('src/App.tsx');
  const container = [...nodes.values()].find(n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && attributes(n).className?.split(/\s+/).includes('document-actions'));
  const children = container?.parent.children?.filter(n=>ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)) ?? [];
  const keys = children.map(child => {
    const open = ts.isJsxElement(child) ? child.openingElement : child;
    const a = attributes(open), tag = open.tagName.getText();
    return a['data-ui-command'] || (tag==='DesktopHtmlExport'?'document.export-html':tag==='DiagnosticsPanel'?'diagnostics':child.getText().includes('新規MD')?'new':'reload');
  });
  const order = keys.indexOf(key)+1;
  if(!order) throw new Error(`文書ツールバーの配置が見つかりません: ${key}`);
  return order;
}
function location(row) {
  const host = hostNames[row.source.kind], file = row.source.file;
  const component = path.basename(file).replace(/\.[^.]+$/, '');
  const fallback = { key: `${file}|${row.orderScope.component}`, name: `${host}／${component}／${row.orderScope.component}の操作領域`, basis: '定義順（実表示順は要確認）', rank: row.source.line * 100000 + row.source.column };
  if (file.endsWith('/editorToolbarActions.ts')) return { ...fallback, key: 'shared|format', name: '共通／コード書式ツールバー', basis: '共通コマンド配列順' };
  if (file.endsWith('/DiagnosticsPanel.tsx') && row.displayName?.startsWith('診断') && row.tag === 'button') return {key:'desktop|document',name:'Desktop／文書操作ツールバー',basis:'親画面の配置順（別部品を合流）',rank:desktopRank('diagnostics')};
  if (file.endsWith('.html')) {
    if (!htmlCache.has(file)) htmlCache.set(file, new JSDOM(fs.readFileSync(path.join(root,file),'utf8')).window.document);
    const doc = htmlCache.get(file);
    const controls = [...doc.querySelectorAll("button,select,option,input,textarea,dialog,menu,summary,[role='button'],[role='menuitem'],[role='toolbar'],[role='dialog']")];
    const element = controls[row.orderScope.ordinal-1];
    const parent = element?.parentElement?.closest('[role="toolbar"],[role="menu"],.toolbar,.preview-tools,dialog,header,nav,aside,form,select');
    if(parent) {
      const title = parent.getAttribute('aria-label') || ({gallery:'図のテンプレートメニュー',form:'図の編集ダイアログ','form-content':'図の編集フォーム',context:'右クリックメニュー'}[parent.id]) || parent.id || parent.className || parent.tagName.toLowerCase();
      return {key:`${file}|html:${[...doc.querySelectorAll('*')].indexOf(parent)}`,name:`Mermaid／${title}`,basis:'HTML内の配置順',rank:row.orderScope.ordinal};
    }
  }
  const { nodes, ast, text } = sourceNodes(file);
  const node = nodes.get(`${row.source.line}:${row.source.column}`);
  if (node && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
    const a = attributes(node);
    // 別コンポーネントで描画されるHTML出力を、実際の呼出し位置へ統合する。
    if ((file === 'src/App.tsx' || file.endsWith('/DesktopHtmlExport.tsx')) && (a['data-ui-command']?.startsWith('document.') || row.displayName === '新規MD' || row.displayName === '再読込')) {
      const command = a['data-ui-command'];
      const rank = desktopRank(command || (row.displayName === '新規MD' ? 'new' : 'reload'));
      return {key:'desktop|document',name:'Desktop／文書操作ツールバー',basis:'親画面の配置順（別部品を合流）',rank};
    }
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isJsxElement(parent) || parent.openingElement === node) continue;
      const open = parent.openingElement, attrs = attributes(open), tag = open.tagName.getText(ast);
      const cls = (attrs.className ?? '').split(/\s+/).find(c => /toolbar|menu|actions|controls|search-bar/.test(c));
      if (!cls && !['select','dialog','details','header','nav','form'].includes(tag) && !['menu','toolbar','dialog'].includes(attrs.role)) continue;
      const title = attrs['aria-label'] || names[cls] || cls || ({select:'選択メニュー',dialog:'ダイアログ',details:'折りたたみメニュー',header:'主ツールバー',nav:'補助ツールバー',form:'入力フォーム'}[tag]) || attrs.role;
      return {key:`${file}|${open.getStart(ast)}`,name:`${host}／${component}／${title}`,basis:'コンテナー内のソース順（条件付き項目も含む）',rank:node.getStart(ast)};
    }
  }
  // DOMで組み立てるSPFxの主ツールバーは書式の反復生成と文書操作を区別する。
  if (file.endsWith('/MdVisualizerController.ts') && row.source.line < 130 && row.controlKind === 'button') {
    const nearby = text.split(/\r?\n/).slice(row.source.line - 1, row.source.line + 6).join('\n');
    const command = nearby.match(/document\.(save|export-html|diff)/)?.[1];
    if (command) return {key:'spfx|document',name:'SPFx／文書操作ツールバー',basis:'DOM追加順',rank:({save:1,'export-html':2,diff:3})[command]};
  }
  return fallback;
}
export function locateControls(controls) {
  const groups = new Map();
  const result = new Map();
  for (const row of controls) {
    const place = location(row);
    if (!groups.has(place.key)) groups.set(place.key, { name: place.name, rows: [] });
    groups.get(place.key).rows.push({ row, place });
  }
  let index = 0;
  for (const group of groups.values()) {
    const groupId = `UI${String(++index).padStart(3,'0')}`;
    group.rows.sort((a,b) => a.place.rank-b.place.rank || a.row.orderScope.ordinal-b.row.orderScope.ordinal);
    group.rows.forEach(({row,place},i) => result.set(row.id,{groupId,name:place.name,order:i+1,number:`${groupId}-${String(i+1).padStart(2,'0')}`,basis:place.basis}));
  }
  return result;
}
