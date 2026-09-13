import {testOutputDirectory,testOutputUrl} from './test-output.mjs';
import {chromium} from 'playwright-core';
import {catalog} from './catalog.js';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1500,height:960}});await page.goto('http://127.0.0.1:4178');await page.waitForFunction(()=>window.mermaidStudio&&!window.mermaidStudio.locked);
const results=[];
for(const t of catalog){await page.locator('.cm-content').click();await page.keyboard.press('Control+A');await page.keyboard.insertText(t.code);await page.waitForFunction(()=>!window.mermaidStudio.locked);const r=await page.evaluate(()=>({items:window.mermaidStudio.model.nodes.map(n=>({id:n.id,label:n.label,mapped:[...document.querySelectorAll('#diagram [data-item]')].some(e=>e.dataset.item===n.id)})),groups:window.mermaidStudio.model.groups.length}));results.push({type:t.id,...r});console.log(t.id,r.items.filter(n=>n.mapped).length+'/'+r.items.length,r.items.filter(n=>!n.mapped).map(n=>n.label).join('|'));}
await writeFile(testOutputUrl('mapping.json'),JSON.stringify(results,null,2));await browser.close();
