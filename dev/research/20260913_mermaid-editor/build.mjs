import { build } from 'esbuild';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root, 'vendor'), { recursive: true });
const mermaidBuild=await build({ stdin: { contents: "export {default} from 'mermaid'", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: path.join(root, 'vendor/mermaid.js'), legalComments: 'eof',metafile:true });
const editorBuild=await build({ stdin: { contents: "export {EditorView,keymap,drawSelection,highlightActiveLine,lineNumbers,Decoration} from '@codemirror/view';export {EditorState,EditorSelection,StateEffect,StateField} from '@codemirror/state';export {history,historyKeymap,defaultKeymap,undo,redo,undoDepth,redoDepth,isolateHistory} from '@codemirror/commands';", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: path.join(root, 'vendor/editor.js'), legalComments: 'eof',metafile:true });
const packages=new Set([...Object.keys(mermaidBuild.metafile.inputs),...Object.keys(editorBuild.metafile.inputs)].map(f=>f.match(/node_modules\/(?:@[^/]+\/)?[^/]+/)?.[0]).filter(Boolean));
await mkdir(path.join(root,'vendor/licenses'),{recursive:true});const notices=['# 同梱ライブラリ\n\nビルドで取り込んだ依存とライセンス。元の著作権表示をlicenses以下に保存する。\n','| パッケージ | 版 | ライセンス |\n|---|---|---|'];
for(const dir of [...packages].sort()){try{const meta=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));notices.push(`| ${meta.name} | ${meta.version} | ${typeof meta.license==='string'?meta.license:JSON.stringify(meta.license)} |`);for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','LICENCE','license','license.txt']){try{const content=await readFile(path.join(dir,file));await writeFile(path.join(root,'vendor/licenses',meta.name.replaceAll('/','_').replaceAll('@','')+'-'+file.replaceAll('.','_')+'.txt'),content);break;}catch{}}}catch{}}
await writeFile(path.join(root,'vendor/THIRD-PARTY-NOTICES.md'),notices.join('\n')+'\n');
const pkg = JSON.parse(await readFile('node_modules/mermaid/package.json', 'utf8'));
await copyFile('node_modules/mermaid/LICENSE', path.join(root, 'vendor/MERMAID-LICENSE'));
await writeFile(path.join(root, 'vendor/version.json'), JSON.stringify({ mermaid: pkg.version }));
console.log('オフライン依存の同梱完了: Mermaid ' + pkg.version);
