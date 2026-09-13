import {chromium} from 'playwright-core';
import {catalog,snippets,previewSnippet} from './catalog.js';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();await page.goto('http://127.0.0.1:4178');await page.waitForFunction(()=>window.mermaidStudio);const results=[];
for(const t of catalog)for(const s of snippets(t.id)){const code=previewSnippet(s.code,t.id);if(!code)continue;const r=await page.evaluate(code=>window.mermaidStudio.renderer.render(code),code);results.push({type:t.id,id:s.id,name:s.name,ok:!!r.svg,error:r.error});if(r.error)console.log(t.id,s.name,r.error.slice(0,220));}
await writeFile(new URL('./test-results/snippets.json',import.meta.url),JSON.stringify(results,null,2));await browser.close();console.log(`${results.filter(r=>r.ok).length}/${results.length}`);assert(results.every(r=>r.ok));
