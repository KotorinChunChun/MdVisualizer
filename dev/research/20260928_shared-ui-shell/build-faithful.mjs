import { build } from '../../../node_modules/esbuild/lib/main.js';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
await mkdir(out, { recursive:true });
const samples=[];
const sampleRoot=path.resolve(here,'../../../samples');
async function collect(dir='') {
  for(const entry of await readdir(path.join(sampleRoot,dir),{withFileTypes:true})) {
    const name=path.posix.join(dir,entry.name);
    if(entry.isDirectory()){await collect(name);continue;}
    if(!/\.(md|tsv|csv|svg|png|jpg|jpeg|gif|mmd|drawio|ts|cpp)$/i.test(name))continue;
    const bytes=await readFile(path.join(sampleRoot,name));
    const ext=path.extname(name).slice(1).toLowerCase();
    samples.push({name,base64:bytes.toString('base64'),text:['png','jpg','jpeg','gif'].includes(ext)?null:bytes.toString('utf8'),mediaType:({svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif'})[ext]??'text/plain'});
  }
}
await collect();
for (const baseline of [true, false]) {
  const result = await build({
    entryPoints: [path.join(here,'faithful/entry.tsx')], absWorkingDir: path.resolve(here,'../../..'),
    outdir: out, bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
    jsxImportSource: baseline ? 'react' : 'preview-jsx', keepNames:true, minify:true,
    loader: { '.md':'text', '.html':'text' }, define: { 'process.env.NODE_ENV':'"production"', 'import.meta.env':'{}' }, metafile:true,
    plugins:[{name:'isolated-preview',setup(api){
      api.onResolve({filter:/^preview-samples$/},()=>({path:'samples',namespace:'preview-samples'}));
      api.onLoad({filter:/.*/,namespace:'preview-samples'},()=>({contents:`export default ${JSON.stringify(samples)}`,loader:'js'}));
      api.onResolve({filter:/^@tauri-apps\//}, () => ({path:path.join(here,'faithful/host.ts')}));
      api.onResolve({filter:/^preview-jsx\/jsx-runtime$/}, () => ({path:path.join(here,'faithful/jsx-runtime.ts')}));
    }}],
  });
  if (Object.keys(result.metafile.inputs).some(file => /node_modules\/@tauri-apps\//.test(file.replaceAll('\\','/')))) throw new Error('Tauri実装が混入');
  const js = result.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file=>file.path.endsWith('.css')).text;
  await writeFile(path.join(out, baseline ? 'reference.js':'faithful.js'),js);
  await writeFile(path.join(out, baseline ? 'reference.css':'faithful.css'),css);
  for (const host of baseline ? ['desktop'] : ['desktop','web','spfx','all']) {
    const name = baseline ? 'reference' : `faithful-${host}`;
    const asset = baseline ? 'reference':'faithful';
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; img-src data: blob:; font-src 'self' data:"><title>MdVisualizer UI試作 ${name}</title><link rel="stylesheet" href="${asset}.css"></head><body data-platform="${host}"><div id="root"></div><script src="${asset}.js"></script></body></html>`;
    await writeFile(path.join(out,`${name}.html`),html);
    if (!baseline && host !== 'all') await writeFile(path.join(out,`master-${host}.html`),html);
  }
}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const options=samples.filter(s=>/\.(md|tsv|svg|mmd|drawio)$/.test(s.name)).map(s=>`<option value="${escape(s.name)}">${escape(s.name)}</option>`).join('');
await writeFile(path.join(out,'master.html'),(await readFile(path.join(here,'faithful/master.html'),'utf8')).replace('<!-- sample-options -->',options));
for (const file of ['comparison.css','comparison.js']) await writeFile(path.join(out,file),await readFile(path.join(here,'faithful',file),'utf8'));
console.log('実物App.tsxから比較基準・Desktop・Web・SPFx・統合版を生成しました。');
