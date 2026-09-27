// Web子リポジトリの正本へ委譲する互換入口。
import { runWebPlatformBuild } from './run-web-platform-build.mjs';
import { auditContract } from './ui-command-contract.mjs';
import { cachedTask } from './validation-cache.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
if (auditContract().errors.length) throw new Error('UI対応表が変更内容と一致しません。');
const root = path.resolve(import.meta.dirname, '..');
// キャッシュ利用時も共有投影の欠落・手修正保護を省略しない。
const setup = spawnSync(process.execPath, ['scripts/setup-web-platform.mjs'], { cwd: root, stdio: 'inherit' });
if (setup.error) throw setup.error;
if (setup.status !== 0) throw new Error('共有正本の接続確認に失敗しました。');
const result = await cachedTask({
  root, name: 'embedded-tools', force: process.argv.includes('--force'),
  inputs: ['scripts/build-embedded-tools.mjs', 'scripts/run-web-platform-build.mjs', 'scripts/setup-web-platform.mjs', 'scripts/sync-desktop-shared.mjs', 'scripts/validation-cache.mjs',
    'package.json', 'package-lock.json', 'node_modules/.package-lock.json', 'web-platform/package.json', 'web-platform/package-lock.json', 'web-platform/node_modules/.package-lock.json',
    'web-platform/targets.json', 'web-platform/scripts', 'web-platform/tools/mermaid-editor', 'web-platform/packages/editor-ui', 'web-platform/packages/markdown-core'],
  excluded: ['web-platform/scripts/node_modules', 'web-platform/scripts/__pycache__', 'web-platform/tools/mermaid-editor/vendor',
    'web-platform/packages/editor-ui/src/generated', 'web-platform/packages/markdown-core/lib', 'web-platform/packages/markdown-core/node_modules'],
  outputs: ['web-platform/packages/editor-ui/src/generated/mermaidEditorDocument.ts', 'web-platform/packages/editor-ui/src/generated/htmlExportBrowserPayload.generated.ts',
    'web-platform/apps/spfx/src/generated/embeddedTools.ts', 'web-platform/packages/markdown-core/lib',
    'src/generated/mermaidEditorDocument.ts', 'src/generated/htmlExportBrowserPayload.generated.ts'],
  run: async () => {
    const previous = process.env.MDV_FORCE_EMBEDDED;
    process.env.MDV_FORCE_EMBEDDED = '1';
    try { await runWebPlatformBuild('build-embedded-tools'); }
    finally { if (previous === undefined) delete process.env.MDV_FORCE_EMBEDDED; else process.env.MDV_FORCE_EMBEDDED = previous; }
  },
});
console.log(JSON.stringify(result));
