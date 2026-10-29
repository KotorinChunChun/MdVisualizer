import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/').replace(/\/$/,'');
const version=process.argv[2] || process.env.MDVISUALIZER_VERSION;
if(!/^v\d+\.\d+\.\d+$/.test(version || '')) throw new Error('対象版をvX.Y.Z形式で指定してください。');
const runId=process.argv[3] || ('settings-appearance-'+Date.now());
if(!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('実行識別子が不正です。');
const css=await readFile(`${root}/src/styles/settings.css`,'utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
const html=`<section class="settings-panel"><fieldset class="settings-section sharepoint-settings"><legend>SharePoint連携</legend><label>SharePointのURL<input value="https://contoso.sharepoint.com/Wiki"></label><p role="alert" class="settings-error">URLを開けませんでした。</p><label>直前の受信URL<textarea readonly>spmd://contoso.sharepoint.com/Wiki/a.md?fixture=1</textarea></label><dd class="sharepoint-received-error">クエリは使用できません。</dd></fieldset></section>`;
try {
  for(const theme of ['light','dark']) for(const width of [390,1200]) {
    const page=await browser.newPage({viewport:{width,height:850}});
    const vars=theme==='light'?'--bg-color:#fff;--text-primary:#222;--text-secondary:#666;--border-color:#ccc':'--bg-color:#161616;--text-primary:#eee;--text-secondary:#aaa;--border-color:#555';
    await page.setContent(`<style>:root{${vars}}*{box-sizing:border-box}body{margin:0}${css}</style>${html}`);
    const colors=await page.locator('.settings-error,.sharepoint-received-error').evaluateAll(nodes=>nodes.map(node=>({color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor})));
    assert.ok(colors.every(item=>item.color==='rgb(255, 255, 255)'&&item.background==='rgb(180, 35, 24)'),JSON.stringify({theme,width,colors}));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    assert.ok(overflow<=1,`${theme} ${width}: overflow ${overflow}`);
    // 元のselectorへ戻すとpのグレーが勝つ。問題を再現できる試験であることも確認する。
    await page.addStyleTag({content:'.settings-panel .settings-error {color:revert-layer}'});
    await page.setContent(`<style>:root{${vars}}${css.replace('.settings-panel .settings-error, .settings-panel .sharepoint-received-error {','.settings-error {')}</style>${html}`);
    assert.notEqual(await page.locator('.settings-error').evaluate(node=>getComputedStyle(node).color),'rgb(255, 255, 255)');
    results.push({theme,width,whiteText:true,redBackground:true,overflow,originalBugReproduced:true});await page.close();
  }
  const output=`${root}/dev/history/${version}/logs/${runId}`;
  await mkdir(output,{recursive:true});await writeFile(`${output}/settings-appearance.json`,JSON.stringify(results,null,2));
  console.log(`PASS: Edge実描画 ${results.length}条件（light/dark、390/1200px）、白文字と赤背景・横溢れ・元の不具合再現`);
} finally {await browser.close();}
