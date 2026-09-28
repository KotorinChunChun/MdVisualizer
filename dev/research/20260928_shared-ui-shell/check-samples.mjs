import {build} from '../../../node_modules/esbuild/lib/main.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const samples=[];
for(const name of ['images/sample.svg','images/sample.png','table.tsv','v0.0.13-table-features.md']){
 const bytes=await readFile(new URL(`../../../samples/${name}`,import.meta.url));
 samples.push({name,base64:bytes.toString('base64'),text:name.endsWith('.png')?null:bytes.toString('utf8'),mediaType:name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/plain'});
}
const bundle=await build({entryPoints:[new URL('./faithful/host.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'iife',globalName:'host',plugins:[{name:'samples',setup(api){api.onResolve({filter:/^preview-samples$/},()=>({path:'samples',namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export default ${JSON.stringify(samples)}`}));}}]});
const context=vm.createContext({TextEncoder,URLSearchParams,location:{search:'?sample=v0.0.13-table-features.md'}});vm.runInContext(bundle.outputFiles[0].text,context);
const host=context.host;
const [path]=await host.invoke('get_initial_files');assert.ok(path.endsWith('v0.0.13-table-features.md'));
const doc=await host.invoke('load_markdown',{path});assert.ok(doc.content.includes('```tsv'));
for(const source of ['images/sample.svg','images/sample.png','table.tsv']){
 const asset=await host.invoke('read_document_asset',{documentPath:path,source});assert.ok(asset.base64.length>0);assert.ok(host.convertFileSrc(asset.path).startsWith(`data:${asset.mediaType};base64,`));
}
const saved=await host.invoke('save_markdown',{request:{path,content:'# 編集結果',expectedRevision:doc.revision}});assert.equal(saved.status,'saved');assert.equal((await host.invoke('load_markdown',{path})).content,'# 編集結果');
assert.equal((await host.invoke('save_markdown',{request:{path,content:'古い内容',expectedRevision:doc.revision}})).status,'conflict');
assert.equal((await host.invoke('load_markdown',{path})).content,'# 編集結果');
for(const source of ['../../../../secret.txt','https://example.com/a.png','C:/private/a.png'])await assert.rejects(host.invoke('read_document_asset',{documentPath:path,source}));
assert.equal((await host.invoke('load_markdown',{path:'C:/UI-Preview/samples/images/sample.svg'})).kind,'svg');
assert.equal((await host.invoke('load_markdown',{path:'C:/UI-Preview/samples/table.tsv'})).kind,'tsv');
console.log('同梱SVG/PNG/TSVの解決・文書種別・メモリー保存・競合保護・試作外参照拒否 OK');
