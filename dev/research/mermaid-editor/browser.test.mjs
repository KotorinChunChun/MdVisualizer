import {chromium} from 'playwright-core';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {catalog} from './catalog.js';
const channel=process.argv[2]||'msedge',base='http://127.0.0.1:4178';
const browser=await chromium.launch({channel,headless:true});
const page=await browser.newPage({viewport:{width:1500,height:960}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto(base);await page.waitForFunction(()=>window.mermaidStudio&&!window.mermaidStudio.locked,{timeout:20000});
const results=[];
for(const t of catalog){const fixture=await readFile(new URL('./samples/'+t.id+'.mmd',import.meta.url),'utf8');const r=await page.evaluate(async ({code})=>{const r=await window.mermaidStudio.renderer.render(code);return {ok:!!r.svg,error:r.error};},{code:fixture});results.push({id:t.id,...r});console.log(t.id,r.ok?'OK':r.error?.slice(0,450));}
await mkdir(new URL('./test-results/',import.meta.url),{recursive:true});await writeFile(new URL(`./test-results/${channel}-samples.json`,import.meta.url),JSON.stringify({results,errors},null,2));
await page.screenshot({path:new URL(`./test-results/${channel}-initial.png`,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
await browser.close();
assert(results.every(r=>r.ok),results.filter(r=>!r.ok).map(r=>r.id).join(', '));assert.equal(errors.length,0,errors.join('\n'));
