import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = path.join(root, 'web-platform');
export async function runWebPlatformBuild(name) {
  for (const [cwd, script] of [[root, 'scripts/setup-web-platform.mjs'], [child, `scripts/${name}.mjs`]]) {
    const result = spawnSync(process.execPath, [script], { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} が失敗しました (${result.status})`);
  }
  await mkdir(path.join(root, 'src/generated'), { recursive: true });
  const generated = name === 'build-mermaid-editor' ? ['mermaidEditorDocument.ts']
    : name === 'build-html-export-browser' ? ['htmlExportBrowserPayload.generated.ts']
      : ['mermaidEditorDocument.ts', 'htmlExportBrowserPayload.generated.ts'];
  for (const file of generated) await copyFile(path.join(child, 'packages/editor-ui/src/generated', file), path.join(root, 'src/generated', file));
  if (name === 'build-web') {
    await mkdir(path.join(root, 'release/web'), { recursive: true });
    await copyFile(path.join(child, 'release/web/mdvisualizer.html'), path.join(root, 'release/web/mdvisualizer.html'));
  }
}
