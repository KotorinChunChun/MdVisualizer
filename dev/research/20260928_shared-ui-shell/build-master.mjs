import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { scanUiControls } from '../../../scripts/ui-control-inventory.mjs';
import ts from '../../../node_modules/typescript/lib/typescript.js';
const here = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, here), 'utf8');
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// 正本の書式操作配列をASTから読み取る。評価・実行はしない。
const editorSource = await read('../../../web-platform/packages/editor-ui/src/lib/editorToolbarActions.ts');
const ast = ts.createSourceFile('actions.ts', editorSource, ts.ScriptTarget.Latest, true);
const actions = [];
function visit(node) { if (ts.isObjectLiteralExpression(node)) { const row = {}; for (const item of node.properties) if (ts.isPropertyAssignment(item) && ts.isStringLiteral(item.initializer)) row[item.name.getText(ast)] = item.initializer.text; if (row.action && row.label && row.title) actions.push(row); } ts.forEachChild(node, visit); }
visit(ast);
let template = await read('master-template.html');
template = template.replace('<!-- EDITOR_ACTIONS -->', actions.map(row => `<button data-platforms="desktop web spfx" data-action="format.${escape(row.action)}" data-write title="${escape(row.title)}">${escape(row.label)}</button>`).join(''));
const inventory = scanUiControls();
const data = JSON.stringify(inventory.controls.map(({displayName, controlKind, source}) => ({displayName, controlKind, source}))).replaceAll('<', '\\u003c');
const css = (await Promise.all(['../../../web-platform/packages/editor-ui/src/styles/app.css','../../../web-platform/packages/editor-ui/src/styles/themes.css','../../../web-platform/packages/editor-ui/src/styles/content.css','master.css'].map(read))).join('\n');
const script = (await read('master-runtime.js')).replace(/<\/script/gi,'<\\/script');
await mkdir(new URL('dist/', here), { recursive:true });
for (const host of ['all','desktop','web','spfx']) {
  const html = `<!doctype html><html lang="ja" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MdVisualizer 統合UIマスター</title><style>${css}</style></head><body data-initial-host="${host}">
<header class="master-lab"><h1>MdVisualizer 統合UIマスター</h1><p>全種類の画面・操作をまとめて確認し、対象環境の属性で絞り込みます。製品接続前の外見試作です。</p><div class="master-lab-controls"><label>表示対象 <select id="platform"><option value="all">統合マスター（全環境）</option><option value="desktop">デスクトップ</option><option value="web">Web</option><option value="spfx">SPFx</option></select></label><label>表示幅 <select id="width"><option value="full">全幅</option><option value="960">960px</option><option value="390">390px</option></select></label><label><input id="readonly" type="checkbox">閲覧権限のみ</label><label><input id="php" type="checkbox">PHP保管を利用可能</label><span id="visible-count"></span></div></header>
<main class="master-page"><div id="preview-width"><div id="generated-ui"></div></div><output id="notice" role="status"></output><details class="inventory"><summary>既存ソースの全操作目録（${inventory.controls.length}件）</summary><p class="muted">生成時に既存ソースから抽出した全操作です。共有ソースの存在は各環境での動作保証ではありません。この目録の全項目を上の外見見本へ移植したものではありません。</p><input id="inventory-search" aria-label="全操作を検索" placeholder="操作名・ファイル名・部品種類で検索"><span id="inventory-count"></span><div class="inventory-scroll"><table><thead><tr><th>操作名</th><th>種類</th><th>実装元</th><th>ソース位置</th></tr></thead><tbody id="inventory-rows"></tbody></table></div></details></main>
<dialog id="sample-dialog" aria-labelledby="dialog-title"><h2 id="dialog-title"></h2><div id="dialog-body"></div><button id="close-dialog">閉じる</button></dialog><template id="ui-master">${template}</template><script type="application/json" id="inventory-data">${data}</script><script>${script}</script></body></html>`;
  await writeFile(new URL(`dist/${host === 'all' ? 'master' : `master-${host}`}.html`,here), html,'utf8');
}
console.log(`統合マスター＋3環境を生成。書式操作${actions.length}件、既存操作目録${inventory.controls.length}件。`);
