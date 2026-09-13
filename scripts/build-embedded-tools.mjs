import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
async function newest(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let time = 0;
  for (const entry of entries) {
    if (['node_modules', '.git', 'logs', 'test-results'].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    time = Math.max(time, entry.isDirectory() ? await newest(full) : (await stat(full)).mtimeMs);
  }
  return time;
}
async function generate(script, output, inputs) {
  const built = await stat(path.join(root, output)).then(value => value.mtimeMs).catch(() => 0);
  const modified = Math.max((await stat(path.join(root, script))).mtimeMs, ...await Promise.all(inputs.map(input => newest(path.join(root, input)))));
  if (built >= modified) return;
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${script} の生成に失敗しました。`);
}
await generate('scripts/build-mermaid-editor.mjs', 'src/generated/mermaidEditorDocument.ts', ['dev/research/20260913_mermaid-editor']);
await generate('scripts/build-html-export-browser.mjs', 'src/generated/htmlExportBrowserPayload.generated.ts', ['scripts/html-export', 'src/styles', 'src/lib', 'packages/markdown-core/src']);
// SPFxのrootDir外を直接参照しない。共有ソースをバンドルして同じ実装を渡す。
const module = await build({ stdin: { contents: 'export { exportHtmlInBrowser, downloadHtml } from "./src/lib/htmlExport"; export { mermaidEditorDocument } from "./src/generated/mermaidEditorDocument";', resolveDir: root, sourcefile: 'embeddedTools.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2017', minify: true, write: false });
const destination = path.join(root, 'spfx/src/generated/embeddedTools.ts');
const code = '// @ts-nocheck\n// scripts/build-embedded-tools.mjsによる生成物。直接編集しない。\n' + module.outputFiles[0].text;
await mkdir(path.dirname(destination), { recursive: true });
if (await readFile(destination, 'utf8').catch(() => '') !== code) await writeFile(destination, code, 'utf8');
