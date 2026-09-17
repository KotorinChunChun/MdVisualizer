import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { auditBlockCommandSemantics } from './check-block-command-semantics.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const baseline = auditBlockCommandSemantics();
assert.deepEqual(baseline.errors, [], `実装契約の初期検査が失敗: ${baseline.errors.join(' / ')}`);

const mutate = (relative, before, after) => {
  const original = source(relative);
  assert(original.includes(before), `fixtureの置換対象がない: ${before}`);
  return { [relative]: original.replaceAll(before, after) };
};
const toolbarFile = 'web-platform/packages/editor-ui/src/components/ResponsiveToolbar.tsx';
const webHostFile = 'web-platform/apps/web/src/main.tsx';
const tableFile = 'web-platform/packages/editor-ui/src/components/DelimitedTableBlock.tsx';
const mermaidFile = 'web-platform/packages/editor-ui/src/components/MermaidBlock.tsx';
const previewFile = 'web-platform/packages/editor-ui/src/components/MarkdownPreview.tsx';
const desktopAppFile = 'src/App.tsx';
const webAppFile = 'web-platform/apps/web/src/WebApp.tsx';

assert(auditBlockCommandSemantics({ files: mutate(toolbarFile, 'items.filter((item) => !item.fixed)', 'items.filter(() => true)') }).errors.some(error => error.includes('固定項目')), 'fixedを退避対象に戻す欠落を検知');
assert(auditBlockCommandSemantics({ files: mutate(webHostFile, 'canUseCodexActions: false', 'canUseCodexActions: true') }).errors.some(error => error.includes('AI操作を無効化')), 'WebでAIを有効化する欠落を検知');
assert(auditBlockCommandSemantics({ files: mutate(tableFile, 'compactNode: <BlockCopyMenu>{tableCopyItems}</BlockCopyMenu>, ', '') }).errors.some(error => error.includes('コピー候補がcompact/menu')), '狭幅コピー候補の欠落を検知');
assert(auditBlockCommandSemantics({ files: mutate(tableFile, '...(onSave ? [{ id: "edit"', '...(false ? [{ id: "edit"') }).errors.some(error => error.includes('writable(onSave)')), '表編集のwritable接続欠落を検知');
assert(auditBlockCommandSemantics({ files: mutate(mermaidFile, '...(editable ? [{ id: "edit"', '...(false ? [{ id: "edit"') }).errors.some(error => error.includes('Mermaid: 編集表示がeditable')), 'Mermaid編集itemの削除を検知');
assert(auditBlockCommandSemantics({ files: mutate(mermaidFile, '...(onCodexSave && capabilities.canUseCodexActions && hasCodexActions ? [{ id: "ai"', '...(false ? [{ id: "ai"') }).errors.some(error => error.includes('Mermaid: AI itemのhost capability条件')), 'Mermaid AI itemの削除を検知');
assert(auditBlockCommandSemantics({ files: mutate(previewFile, '=> context.onCodeFenceBodyChange?.(occurrence, body)', '=> undefined') }).errors.some(error => error.includes('MarkdownPreview: MermaidのAI/GUI保存props接続')), 'MarkdownPreviewからMermaid AI保存接続を外す欠落を検知');
assert(auditBlockCommandSemantics({ files: mutate(desktopAppFile, 'allowBlockActions={canEditActive && interactionMode === "edit" && !printing && !activeTab.saving}', 'allowBlockActions={false}') }).errors.some(error => error.includes('Desktop: allowBlockActions')), 'Desktopのblock actionをfalse化する欠落を検知');
assert(auditBlockCommandSemantics({ files: mutate(webAppFile, 'allowBlockActions={interactionMode === "edit"}', 'allowBlockActions={false}') }).errors.some(error => error.includes('Web: allowBlockActions')), 'Webのblock actionをfalse化する欠落を検知');

console.log(`ブロックコマンド意味契約: 実assert ${baseline.checks}件、意図的ミューテーション9件を検知（${baseline.elapsedMs}ms）`);
