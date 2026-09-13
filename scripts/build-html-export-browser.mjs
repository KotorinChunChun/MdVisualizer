import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = path.join(root, 'scripts/html-export/browser.tsx');
const destination = path.join(root, 'src/generated/htmlExportBrowserPayload.generated.ts');

const result = await build({
  configFile: false,
  root,
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    minify: true,
    target: 'es2022',
    lib: { entry, name: 'HtmlExport', formats: ['iife'] },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const output = Array.isArray(result) ? result[0].output : result.output;
const code = output.find((item) => item.type === 'chunk' && item.isEntry)?.code;
if (!code) throw new Error('HTML出力ブラウザーのバンドルを取得できません。');
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, `// scripts/build-html-export-browser.mjs により生成。直接編集しない。\nexport const htmlExportBrowserPayload = ${JSON.stringify(code)};\n`, 'utf8');
