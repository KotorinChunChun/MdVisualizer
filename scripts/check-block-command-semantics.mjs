import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function parseTsv(text) {
  const rows = text.trimEnd().split(/\r?\n/).map(line => line.split('\t'));
  const header = rows.shift();
  return rows.map(values => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
}

function objectProperties(source) {
  const file = ts.createSourceFile('contract.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const items = new Map();
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const values = new Map();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
        values.set(property.name.text, property.initializer);
      }
      const id = values.get('id');
      if (id && ts.isStringLiteral(id)) items.set(id.text, values);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return items;
}

function isTrue(node) { return node && node.kind === ts.SyntaxKind.TrueKeyword; }
function has(properties, name) { return properties?.has(name); }

function jsxProperties(source, componentName) {
  const file = ts.createSourceFile('contract.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === componentName) {
      matches.push(new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.text, attribute.initializer])));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return matches;
}

function collectErrors(config, readFile) {
  const errors = [];
  let checks = 0;
  const expect = (condition, message) => { checks++; if (!condition) errors.push(message); };
  const read = relative => readFile(relative);
  const markdown = read(config.specification.markdown);
  const definition = parseTsv(read(config.specification.definition));
  const finalOrder = parseTsv(read(config.specification.finalOrder));
  const definitionIds = new Set(definition.map(row => row['共通ID']));
  const finalOrderIds = new Set(finalOrder.map(row => row['共通ID']));

  for (const marker of ['編集・折り返し', 'WebにはAI関連操作を表示しない', '全操作・ラベル・余白が実測で収まる']) {
    expect(markdown.includes(marker), `仕様本文に必須の表示契約がない: ${marker}`);
  }
  for (const id of config.requiredCommandIds) {
    expect(definitionIds.has(id), `定義表に共通IDがない: ${id}`);
    expect(finalOrderIds.has(id), `最終配置表に共通IDがない: ${id}`);
  }

  const source = Object.fromEntries(Object.entries(config.implementationFiles).map(([name, file]) => [name, read(file)]));
  const toolbar = source.toolbar;
  for (const marker of ['responsiveThreeStageState', 'items.filter((item) => !item.fixed)', 'items.filter((item) => item.fixed)', 'item.menuNode ?? item.node', 'responsive-toolbar__menu-separator']) {
    expect(toolbar.includes(marker), `ResponsiveToolbarの幅・固定項目・メニュー契約が欠落: ${marker}`);
  }

  const codeItems = objectProperties(source.code);
  const tableItems = objectProperties(source.table);
  const diagramItems = objectProperties(source.diagram);
  const mermaidItems = objectProperties(source.mermaid);
  const mustBeFixed = (items, id, label) => {
    expect(isTrue(items.get(id)?.get('fixed')), `${label}: ${id} は狭幅でも固定表示の項目ではない`);
  };
  const mustCopyAcrossWidths = (items, label) => {
    const copy = items.get('copy');
    expect(has(copy, 'compactNode') && has(copy, 'menuNode'), `${label}: コピー候補がcompact/menuへ接続されていない`);
  };
  mustBeFixed(codeItems, 'wrap', 'コード');
  mustBeFixed(codeItems, 'edit', 'コード');
  mustBeFixed(codeItems, 'ai', 'コード');
  mustCopyAcrossWidths(codeItems, 'コード');
  mustBeFixed(tableItems, 'search', '表');
  mustBeFixed(tableItems, 'edit', '表');
  mustBeFixed(tableItems, 'ai', '表');
  mustCopyAcrossWidths(tableItems, '表');
  mustBeFixed(diagramItems, 'edit', 'draw.io');
  mustBeFixed(diagramItems, 'ai', 'draw.io');
  mustCopyAcrossWidths(diagramItems, 'draw.io');
  mustBeFixed(mermaidItems, 'edit', 'Mermaid');
  mustBeFixed(mermaidItems, 'ai', 'Mermaid');
  mustCopyAcrossWidths(mermaidItems, 'Mermaid');

  for (const [label, text, condition, saveName] of [
    ['コード', source.code, 'capabilities.canUseCodexActions && hasCodeCodexActions && codexMenu ? [{ id: "ai"', 'codexMenu'],
    ['表', source.table, 'onSave && enableCodex && capabilities.canUseCodexActions ? [{ id: "ai"', 'onSave={onSave}'],
    ['draw.io', source.diagram, 'onSave && capabilities.canUseCodexActions && hasCodexActions ? [{ id: "ai"', 'onSave={onSave}'],
    ['Mermaid', source.mermaid, 'onCodexSave && capabilities.canUseCodexActions && hasCodexActions ? [{ id: "ai"', 'onSave={onCodexSave}'],
  ]) {
    expect(text.includes(condition), `${label}: AI itemのhost capability条件がない`);
    expect(text.includes(saveName), `${label}: AI itemの保存コールバック接続がない`);
  }
  expect(source.code.includes('capabilities.canRunPowerShell &&'), 'コード: PowerShell実行のホストcapability配線がない');
  expect(source.webHost.includes('canUseCodexActions: false'), 'Webホスト: AI操作を無効化していない');
  expect(source.webHost.includes('canRunPowerShell: false'), 'Webホスト: PowerShell実行を無効化していない');
  expect(source.capabilities.includes('canUseCodexActions: true'), 'Desktop capabilityのAI許可がない');

  expect(source.table.includes('...(onSave ? [{ id: "edit"'), '表: 編集表示がwritable(onSave)に接続されていない');
  expect(source.diagram.includes('...(onSave ? [{ id: "edit"'), 'draw.io: 編集表示がwritable(onSave)に接続されていない');
  expect(source.code.includes('...(onSourceChange ? [{ id: "edit"'), 'コード: 編集表示がwritable(onSourceChange)に接続されていない');
  expect(source.mermaid.includes('...(editable ? [{ id: "edit"'), 'Mermaid: 編集表示がeditableに接続されていない');
  expect(source.mermaid.includes('onSourceChange ?? onCodexSave'), 'Mermaid: GUI編集の保存経路がonSourceChange/onCodexSaveへ接続されていない');

  const mermaidPreview = jsxProperties(source.preview, 'MermaidBlock').find(properties => properties.has('editable'));
  expect(Boolean(mermaidPreview), 'MarkdownPreview: MermaidBlockの編集props接続がない');
  const previewSave = mermaidPreview?.get('onCodexSave')?.getText() ?? '';
  const previewEdit = mermaidPreview?.get('onSourceChange')?.getText() ?? '';
  expect(previewSave.includes('=> context.onCodeFenceBodyChange?.(occurrence, body)') && previewEdit.includes('=> context.onCodeFenceBodyChange?.(occurrence, body)'), 'MarkdownPreview: MermaidのAI/GUI保存props接続がない');
  expect(source.preview.includes('const blockActionsEnabled = allowBlockActions ?? !readOnly'), 'MarkdownPreview: allowBlockActionsをblockActionsEnabledへ渡していない');
  expect(source.preview.includes('onCodeFenceBodyChange: blockActionsEnabled ? onCodeFenceBodyChange : undefined'), 'MarkdownPreview: blockActionsEnabledをコード保存contextへ適用していない');
  expect(source.preview.includes('onInlineSvgChange: blockActionsEnabled ? onInlineSvgChange : undefined'), 'MarkdownPreview: blockActionsEnabledをSVG保存contextへ適用していない');
  for (const [label, text] of [['Desktop', source.desktopApp], ['Web', source.webApp]]) {
    const previews = jsxProperties(text, 'MarkdownPreview');
    expect(previews.some(properties => properties.has('allowBlockActions')), `${label}: MarkdownPreviewへallowBlockActionsを渡していない`);
    expect(previews.some(properties => properties.has('onCodeFenceBodyChange')), `${label}: MarkdownPreviewへonCodeFenceBodyChangeを渡していない`);
  }
  const desktopPreview = jsxProperties(source.desktopApp, 'MarkdownPreview').find(properties => properties.has('allowBlockActions'));
  const desktopBlockActions = desktopPreview?.get('allowBlockActions')?.getText() ?? '';
  expect(desktopBlockActions.replace(/\s/g, '') === '{previewOperationPolicy({writable:canEditActive,interactionMode,printing,saving:activeTab.saving}).editBlocks}', 'Desktop: 共通操作ポリシーの接続が変更されている');
  const webPreview = jsxProperties(source.webApp, 'MarkdownPreview').find(properties => properties.has('allowBlockActions'));
  const webBlockActions = webPreview?.get('allowBlockActions')?.getText() ?? '';
  expect(webBlockActions.replace(/\s/g, '') === '{previewOperationPolicy({writable:true,interactionMode,presentation:layout==="presentation"}).editBlocks}', 'Web: 共通操作ポリシーの接続が変更されている');
  // 定義表の現状欄には過去の比較記録もある。ここは現在の未実装判定ではなく、
  // 実画面または個別調査で再確認すべき記録として出力する。
  const historicalReviewNotes = definition.filter(row => /要整備|要確認|未対応/.test(Object.values(row).join('\t'))).map(row => ({ level: row['レベル'], id: row['共通ID'], note: Object.values(row).find(value => /要整備|要確認|未対応/.test(value)) })).filter((row, index, all) => all.findIndex(other => other.id === row.id && other.note === row.note) === index);
  return { errors, checks, historicalReviewNotes };
}

export function auditBlockCommandSemantics({ root = repositoryRoot, files = {} } = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/block-command-semantics.json'), 'utf8'));
  const readFile = relative => Object.hasOwn(files, relative) ? files[relative] : fs.readFileSync(path.join(root, relative), 'utf8');
  const started = performance.now();
  const { errors, checks, historicalReviewNotes } = collectErrors(config, readFile);
  const result = { status: errors.length ? 'failed' : 'passed', checks, errors, historicalReviewNotes, elapsedMs: Number((performance.now() - started).toFixed(1)) };
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = auditBlockCommandSemantics();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
