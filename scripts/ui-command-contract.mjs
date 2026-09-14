import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import postcss from 'postcss';
import { scanUiControls } from './ui-control-inventory.mjs';
import { locateControls } from './ui-control-locations.mjs';

const root = path.resolve(import.meta.dirname, '..');
const contractPath = path.join(root, 'config/ui-command-contract.json');
const documentPath = path.join(root, 'docs/developer/ui/UI_COMMAND_MATRIX.md');
const tablePath = path.join(root, 'docs/developer/ui/UI_COMMAND_MATRIX.tsv');
const signature = value => crypto.createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// リンク・呼出しの存在と、実画面で操作可能であることは別の判定にする。
function assessment(row) {
  const common = row.source.kind === 'shared';
  const native = /features\/codex\/|Codex|ExternalActions|Settings|TabBar|StatusBar|Window|FileDropZone/.test(row.source.file);
  const status = {};
  for (const host of ['desktop', 'html', 'php', 'spfx']) {
    if (native && host !== 'desktop') status[host] = '対象外:デスクトップのAI/OS/設定/タブ機能';
    else if (common) status[host] = host === 'spfx' ? '共有部品:ホストでの使用条件確認' : '共通正本';
    else if (row.source.kind === 'web' && (host === 'html' || host === 'php')) status[host] = 'Web共通実装';
    else if (row.source.kind === host) status[host] = 'ホスト固有実装';
    else status[host] = '別実装/未対応:照合対象';
  }
  if (/ServerStorage/.test(row.source.file)) {
    status.php = '実装:明示操作による暗号化一時保管';
    status.html = '対象外:サーバーへ保存しないHTML版';
  }
  return { hosts: status, nameCheck: row.labelKind === 'static' ? '静的照合' : '要実画面確認:動的表示/子要素', orderCheck: common ? '共通ソース順序' : 'ホスト内ソース順序', designCheck: common ? '共有CSS+ホスト上書きを別検査' : 'ホストCSSを別検査' };
}

function mappedAssessment(row, overrides) {
  const next = assessment(row);
  for (const rule of overrides) if (rule.file === row.source.file && (!rule.displayNames || rule.displayNames.includes(row.displayName))) {
    next.hosts = { ...next.hosts, ...rule.hosts }; next.evidence = rule.evidence;
  }
  return next;
}

function cssRecords() {
  const entries = [], seen = new Set();
  for (const base of ['src', 'web-platform/packages/editor-ui/src', 'web-platform/apps/web/src', 'web-platform/apps/spfx/src', 'web-platform/tools/mermaid-editor']) {
    const walk = directory => {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        if (['generated', 'vendor', 'node_modules', 'tests', 'private', 'temp', 'samples'].includes(item.name) || item.name === 'build.mjs') continue;
        const file = path.join(directory, item.name);
        if (item.isDirectory()) walk(file);
        else if (/\.(css|scss)$/.test(file)) {
          const relative = slash(path.relative(root, file));
          if (relative.startsWith('src/') && fs.existsSync(path.join(root, 'web-platform/packages/editor-ui', relative))) continue;
          const parsed = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
          parsed.walkRules(rule => {
            if (!/button|btn|control|action|toolbar|select|input|summary|menu/i.test(rule.selector)) return;
            const declarations = (rule.nodes ?? []).filter(n => n.type === 'decl' && /^(?:min-|max-)?height$|^font(?:-size|-family)?$|^line-height$|^padding|^border(?:-radius)?$|^gap$|^background(?:-color)?$|^color$/.test(n.prop));
            if (!declarations.length) return;
            const context = []; for (let p = rule.parent; p; p = p.parent) if (p.type === 'atrule') context.unshift(`@${p.name} ${p.params}`);
            const key = `${relative}|${context.join('/')}|${rule.selector}`;
            const occurrence = entries.filter(e => e.key === key).length;
            const values = declarations.map(d => `${d.prop}:${d.value}${d.important ? '!important' : ''}`);
            const id = signature(`${key}|${occurrence}`).slice(0, 16);
            if (seen.has(id)) throw new Error('CSS ID重複'); seen.add(id);
            entries.push({ id, key, file: relative, line: rule.source.start.line, values, signature: signature(values.join(';')) });
          });
        }
      }
    }; walk(path.join(root, base));
  }
  return entries;
}

export function compareInventory(expected, actual) {
  const errors = [], current = new Map(actual.map(row => [row.id, row]));
  for (const row of expected) {
    const found = current.get(row.id);
    if (!found) errors.push(`削除/順序変更: ${row.id}`);
    else if (found.signature !== row.signature) errors.push(`表示/操作/デザイン変更: ${row.id}`);
    current.delete(row.id);
  }
  for (const id of current.keys()) errors.push(`未登録: ${id}`);
  return errors;
}

const coreCommands = [
  { id: 'document.save', label: '保存', variants: ['保存中…', 'ZIPを保存'], order: 10 },
  { id: 'document.export-html', label: 'HTML出力', order: 20 },
  { id: 'document.diff', label: '差分', order: 30 },
  { id: 'document.print', label: '印刷', order: 50 },
];

function checkCore() {
  const errors = [], files = ['src/App.tsx', 'src/components/DesktopHtmlExport.tsx', 'web-platform/apps/web/src/WebApp.tsx', 'web-platform/apps/spfx/src/webparts/mdVisualizer/MdVisualizerController.ts'];
  for (const file of files) {
    const text = read(file);
    for (const command of coreCommands) {
      const index = text.indexOf(`"${command.id}"`) >= 0 ? text.indexOf(`"${command.id}"`) : text.indexOf(`'${command.id}'`);
      if (index < 0) continue;
      const region = file.endsWith('Controller.ts') ? text.slice(Math.max(0, index - 130), index + 240) : text.slice(index, text.indexOf('</button>', index));
      if (!region.includes(command.label)) errors.push(`${file}: ${command.id} の表示名は ${command.label}`);
    }
  }
  const desktop = read(files[0]), web = read(files[2]), spfx = read(files[3]);
  for (const [name, text, markers] of [
    ['desktop', desktop, ['document.save', '<DesktopHtmlExport', 'document.diff', 'document.print']],
    ['html/php', web, coreCommands.map(c => c.id)],
    ['spfx', spfx, coreCommands.slice(0, 3).map(c => c.id)],
  ]) {
    const positions = markers.map(m => text.indexOf(m));
    if (positions.some((p, i) => p < 0 || (i && p <= positions[i - 1]))) errors.push(`${name}: 文書コマンド順序不一致`);
  }
  if (!read('web-platform/packages/editor-ui/src/spfxWorkspaceViewControlsBridge.tsx').includes('style.textContent = workspaceControlCss')) errors.push('SPFx表示切替CSSが共通正本を使用していない');
  if (!read('web-platform/apps/spfx/src/webparts/mdVisualizer/MdVisualizerController.ts').includes('EDITOR_TOOLBAR_ACTIONS')) errors.push('SPFx書式コマンドが共通定義を使用していない');
  return errors;
}

function renderMatrix(contract, inventory) {
  const lines = ['# UI機能対応表', '', '正本は `config/ui-command-contract.json`。`npm run check:ui-contract` が未登録・削除・名称/順序/属性変更・CSS変更とこの表の更新漏れを検出する。表はソース上の対応を示し、非表示条件・実寸・実操作の合格を推測しない。', '', '## 共通の操作規約', '', '| ID | 表示名 | 許容する状態表示 | 相対順序 |', '| --- | --- | --- | --- |', ...contract.commands.map(c => `| ${c.id} | ${c.label} | ${(c.variants ?? []).join(' / ')} | ${c.order} |`), '', '書式操作は `editorToolbarActions.ts` の単一リストをDesktop/HTML/PHP/SPFxで使用する。表示切替は共通部品とCSSを使用する。デスクトップの新規/再読込、Webの開く/ZIP、PHPの一時保管など固有操作は共通コマンドの相対順を崩さず配置する。', '', '## 全操作の登録', '', `登録 ${contract.controls.length} 件。動的表示の展開、条件付き表示、キーボード到達、画面の高さは実画面で別途確認する。「別実装/未対応」は利用不可の承認や合格を意味しない。`, '', '番号は同じ操作領域内で1から付ける。UIxxxがツールバー/メニューの識別番号、末尾が項目順。子メニューは別領域とし、動的生成など実表示順を確定できない箇所は定義順と明記する。既存のui-IDは変更しない。', '', '[全操作の登録表（TSV）](/docs/developer/ui/UI_COMMAND_MATRIX.tsv)を開いてください。UTF-8、ヘッダー付き、タブ区切りです。'];
  lines.push('', '## デザインの静的検査', '', `操作UIに関するCSS ${contract.css.length} 規則を登録。値変更はレビューが必要。既存のCSS分布レポートは用途別の少数値を示すが、少数値だけで不具合とは判定しない。共有CSSでもホスト側のカスケード差は実寸検査が必要。`, '');
  return lines.join('\n');
}

export function renderMatrixTsv(contract) {
  const cell = value => {
    const text = String(value ?? '動的/未抽出');
    return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  const rows = [['UI番号','ツールバー／メニュー名','順序の根拠','ID','機能/表示名','Desktop','HTML','PHP','SPFx','名前・順序・デザインの判定方法','定義位置']];
  for (const c of [...contract.controls].sort((a,b) => a.location.groupId.localeCompare(b.location.groupId) || a.location.order-b.location.order)) {
    rows.push([c.location.number,c.location.name,c.location.basis,c.id,c.displayName,c.hosts.desktop,c.hosts.html,c.hosts.php,c.hosts.spfx,`${c.nameCheck}; ${c.orderCheck}; ${c.designCheck}`,`${c.source.file}:${c.source.line}`]);
  }
  return rows.map(row => row.map(cell).join('\t')).join('\n') + '\n';
}

export function auditContract({ update = false } = {}) {
  const inventory = scanUiControls(), css = cssRecords();
  const locations = locateControls(inventory.controls);
  const overrides = JSON.parse(read('config/ui-host-mappings.json')).overrides;
  if (update) {
    // 初回/レビュー後の明示操作のみ。通常チェックは基準を更新しない。
    const controls = inventory.controls.map(row => ({ ...row, ...mappedAssessment(row, overrides), location: locations.get(row.id) }));
    const contract = { schemaVersion: 1, commands: coreCommands, controls, css };
    fs.mkdirSync(path.dirname(contractPath), { recursive: true });
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n');
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(documentPath, renderMatrix(contract, inventory));
    fs.writeFileSync(tablePath, renderMatrixTsv(contract));
  }
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const errors = [...compareInventory(contract.controls, inventory.controls), ...compareInventory(contract.css, css), ...checkCore()];
  for (const row of contract.controls) if (JSON.stringify(row.hosts) !== JSON.stringify(mappedAssessment(row, overrides).hosts)) errors.push(`${row.id}: 対応分類と正本の更新が一致しない`);
  for (const row of contract.controls) if (JSON.stringify(row.location) !== JSON.stringify(locations.get(row.id))) errors.push(`${row.id}: 所属領域または項目順が対応表と一致しない`);
  for (const row of contract.controls) if (!row.hosts || Object.values(row.hosts).some(v => !v)) errors.push(`${row.id}: ホスト対応/理由がない`);
  if (fs.readFileSync(documentPath, 'utf8') !== renderMatrix(contract, inventory)) errors.push('対応表の生成内容が古い');
  if (!fs.existsSync(tablePath) || fs.readFileSync(tablePath, 'utf8') !== renderMatrixTsv(contract)) errors.push('TSV登録表の生成内容が古い');
  const result = { status: errors.length ? 'failed' : 'passed', controls: inventory.controls.length, cssRules: css.length, runtimeNameChecks: inventory.controls.filter(c => c.labelKind !== 'static').length, crossHostReview: contract.controls.filter(c => Object.values(c.hosts).some(v => v.startsWith('別実装/未対応'))).length, errors };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = auditContract({ update: process.argv.includes('--accept-reviewed') });
  if (result.errors.length) process.exitCode = 1;
}
