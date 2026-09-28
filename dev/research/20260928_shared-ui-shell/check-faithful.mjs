import { JSDOM, VirtualConsole } from '../../../node_modules/jsdom/lib/api.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const read = file => readFile(new URL(`./dist/${file}`,import.meta.url),'utf8');
const delay = () => new Promise(resolve=>setTimeout(resolve,80));
async function boot(asset, platform) {
  const errors=[];
  const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message)); vc.on('error',(...args)=>errors.push(args.map(String).join(' ')));
  const dom=new JSDOM(`<html><body data-platform="${platform}"><div id="root"></div></body></html>`,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://preview.invalid',virtualConsole:vc});
  const w=dom.window;
  w.TextEncoder=TextEncoder; w.TextDecoder=TextDecoder;
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLElement.prototype.scrollTo=function(){};
  w.Range.prototype.getClientRects=()=>[];
  w.Range.prototype.getBoundingClientRect=()=>({top:0,left:0,bottom:0,right:0,width:0,height:0});
  w.eval(await read(`${asset}.js`));
  for(let i=0;i<30;i++){await delay();if(w.document.querySelector('.markdown-body h1') && w.document.querySelector('.cm-editor'))break;}
  await delay();await delay();
  if(errors.length) { globalThis.console.error(errors); dom.window.close(); throw new Error(`${asset}/${platform}: 初期化エラー`); }
  assert.ok(w.document.querySelector('.markdown-body h1'), `${asset}: 文書読込`);
  return {dom,errors};
}
function snapshot(document){
  const clone=document.getElementById('root').cloneNode(true);
  for(const el of clone.querySelectorAll('*')){
    el.removeAttribute('data-platforms');
    // React useIdは同一ページ内の一意ID。別ルート間では番号だけ正規化。
    for(const attr of [...el.attributes])if(/_[rR]_/.test(attr.value))el.setAttribute(attr.name,attr.value.replace(/_[rR]_[a-z0-9]+_/g,'_react-id_'));
  }
  const values=[...document.getElementById('root').querySelectorAll('input,select,textarea')].map(el=>({tag:el.tagName,value:el.value,checked:el.checked,disabled:el.disabled}));
  return clone.innerHTML+JSON.stringify(values);
}
const reference=await boot('reference','desktop');
const generated=await boot('faithful','desktop');
function equalDom(a,b,label){const x=snapshot(a),y=snapshot(b);if(x!==y){let i=0;while(x[i]===y[i])i++;throw new Error(`${label}: offset ${i}\n基準: ${x.slice(i-100,i+230)}\n生成: ${y.slice(i-100,i+230)}`);}}
try{
  const a=reference.dom.window.document,b=generated.dom.window.document;
  equalDom(a,b,'初期画面DOMが元のAppと一致');
  assert.equal(await read('faithful.css'),await read('reference.css'),'CSSが完全一致');
  for(const label of ['目次パネル','検索パネル','画像パネル']) {
    for(const d of [a,b]) d.querySelector(`[aria-label="${label}"]`).click();
    await delay();equalDom(a,b,`${label}: DOM一致`);
    for(const d of [a,b]) d.querySelector('.document-side-panel__header button').click();
    await delay();
  }
  const button=(d,label)=>[...d.querySelectorAll('button')].find(el=>el.textContent===label);
  for(const label of ['コード｜ビジュアル','ビジュアル','コード']){
    button(a,label).click();button(b,label).click();await delay();await delay();
    equalDom(a,b,`${label}: DOM一致`);
  }
  for(const d of [a,b]) d.querySelector('[aria-label="テーマ"]').value='dark';
  for(const {dom} of [reference,generated]) dom.window.document.querySelector('[aria-label="テーマ"]').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await delay(); equalDom(a,b,'ダークテーマDOM一致');
  assert.deepEqual(reference.errors,[]);assert.deepEqual(generated.errors,[]);
  console.log('Desktop: 元のAppとの初期DOM・3表示モード・テーマ・全CSS一致');
}finally{reference.dom.window.close();generated.dom.window.close();}
for(const platform of ['web','spfx','all']){
 const instance=await boot('faithful',platform);
 try{
   const d=instance.dom.window.document;
   if(platform!=='all'){assert.equal(d.querySelector('.tab-bar'),null);assert.equal(d.querySelector('.codex-toolbar-action'),null);}
   const labels=[...d.querySelectorAll('button')].map(el=>el.textContent);
   assert.equal(labels.includes('ZIPを保存'),platform!=='spfx');
   assert.equal(labels.includes('ファイル一覧'),platform!=='web');
   const hostGroups=[...d.querySelectorAll('[data-host-group]')];
   assert.equal(hostGroups.length,platform==='all'?3:1,'環境固有操作は独立グループ');
   assert.equal(d.querySelector('.control-group.document-actions:not([data-host-group])').textContent.includes('ZIPを保存'),false,'既存の文書操作グループに追加ボタンを混入しない');
   for(const group of hostGroups){assert.ok(group.querySelector('.control-group__title'));assert.ok(group.querySelector('button'));}
   for(const group of d.querySelectorAll('.workspace-view-controls')){
     const children=[...group.children];
     assert.notEqual(children[0]?.getAttribute('role'),'separator');
     assert.notEqual(children.at(-1)?.getAttribute('role'),'separator');
     for(let i=1;i<children.length;i++)assert.ok(!(children[i].getAttribute('role')==='separator'&&children[i-1].getAttribute('role')==='separator'));
   }
   assert.deepEqual(instance.errors,[]);
   console.log(`${platform}: 実物UI起動・対象外除去・固有操作追加 OK`);
 }finally{instance.dom.window.close();}
}
// 比較用外枠は表示対象の切替で幅を半分にしない。
const comparison=new JSDOM(await read('master.html'),{runScripts:'outside-only',url:'https://preview.invalid'});
try{
 comparison.window.eval(await read('comparison.js'));
 const d=comparison.window.document;
 assert.equal(d.getElementById('stage').style.width,'1280px');
 d.getElementById('show-baseline').click();
 assert.equal(d.getElementById('stage').style.width,'1280px');
 assert.equal(d.getElementById('baseline').getAttribute('aria-hidden'),'false');
 d.getElementById('show-result').click();
 assert.equal(d.getElementById('stage').style.width,'1280px');
 assert.equal(d.getElementById('result').getAttribute('aria-hidden'),'false');
 for(const width of ['390','760','960','1600']){const field=d.getElementById('width');field.value=width;field.dispatchEvent(new comparison.window.Event('change'));assert.equal(d.getElementById('stage').style.width,`${width}px`);}
 console.log('比較外枠: 切替前後で寸法を維持、390/760/960/1280/1600pxの幅指定 OK（実測ではなく指定値検査）');
}finally{comparison.window.close();}
