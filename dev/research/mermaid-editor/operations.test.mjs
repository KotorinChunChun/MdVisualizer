import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {catalog} from './catalog.js';
import {addNode,parseModel,deleteNodes,updateNode,groupNodes,capabilities} from './core.js';
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:4178');await page.waitForFunction(()=>window.mermaidStudio);
const results=[];
for(const t of catalog){if(t.id==='info')continue;t.code=await readFile(new URL('./samples/'+t.id+'.mmd',import.meta.url),'utf8');for(const op of ['add','rename','delete','group']){try{const model=parseModel(t.code),n=model.nodes.find(n=>n.defined)||model.nodes[0];if(!n)continue;let code;if(op==='add')code=addNode(t.code,'追加').source;else if(op==='rename')code=n.rawOnly?updateNode(t.code,n.id,{raw:t.code.slice(n.from,n.to).replace(/\d+/,x=>String(Number(x)+1))}):updateNode(t.code,n.id,{label:'変更'});else if(op==='delete')code=deleteNodes(t.code,[n.id]);else {if(!capabilities(t.id).group)continue;code=groupNodes(t.code,[n.id],'まとまり');}assert.notEqual(code,t.code,'操作後のソースが変更される');const r=await page.evaluate(code=>window.mermaidStudio.renderer.render(code),code);results.push({type:t.id,op,ok:!!r.svg,error:r.error,code});if(!r.svg)console.log(t.id,op,r.error?.slice(0,180));}catch(e){results.push({type:t.id,op,ok:false,error:e.message});console.log(t.id,op,e.message);}}}
await writeFile(new URL('./test-results/operations.json',import.meta.url),JSON.stringify(results,null,2));console.log(results.filter(r=>r.ok).length+'/'+results.length);await browser.close();assert(results.every(r=>r.ok),results.filter(r=>!r.ok).map(r=>r.type+':'+r.op).join(', '));
