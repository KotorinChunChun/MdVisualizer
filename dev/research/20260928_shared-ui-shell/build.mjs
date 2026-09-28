import { build } from '../../../node_modules/esbuild/lib/main.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [path.join(here, 'shell.tsx')], bundle: true, write: false,
  outdir: path.join(here, 'dist'), platform: 'browser', format: 'iife',
  jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
});
const inputs = Object.keys(result.metafile.inputs);
if (inputs.some(name => name.includes('@tauri-apps'))) throw new Error('試作にOS依存が混入しています。');
const js = result.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
await mkdir(path.join(here, 'dist'), { recursive: true });
for (const host of ['desktop', 'web', 'spfx']) {
  await writeFile(path.join(here, 'dist', `${host}.html`), `<!doctype html>
<html lang="ja" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MdVisualizer 共通UI試作 — ${host}</title><style>${css}</style></head>
<body data-initial-host="${host}"><div id="root"></div><script>${js}</script></body></html>`, 'utf8');
}
console.log('同一UIから desktop.html / web.html / spfx.html を生成しました（外部通信・OS依存なし）。');
