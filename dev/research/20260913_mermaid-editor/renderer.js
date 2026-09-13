import {parseModel} from './core.js';
import {annotateFlowEdges} from './edge-identity.js';
import mermaid from './vendor/mermaid.js';
const initialize=()=>mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'default',fontFamily:'Segoe UI, Meiryo, sans-serif',flowchart:{htmlLabels:false},maxTextSize:150000});
let serial=0;const namespace='mm'+crypto.randomUUID().replaceAll('-','');
const parentOrigin=new URL(document.referrer).origin;
if(!['localhost','127.0.0.1'].includes(new URL(parentOrigin).hostname))throw Error('ローカルの編集画面から開いてください');
addEventListener('message',async e=>{
 if(e.source!==parent||e.origin!==parentOrigin||e.data?.kind!=='render')return;
 initialize();const {id,code,recover}=e.data;const start=performance.now(),original=code.split('\n'),work=[...original],excluded=[],diagnostics=[];
 const send=payload=>parent.postMessage({kind:'render-result',id,...payload},parentOrigin);
 for(let attempts=0;attempts<Math.min(original.length+2,100)&&performance.now()-start<9500;attempts++){
  try{let input=work.join('\n');const labels=new Map();if(/^\s*sankey-beta/.test(input)){input=input.split('\n').map(l=>l.replace(/^\s*("(?:[^"]|"")*"|[^,]+),("(?:[^"]|"")*"|[^,]+),\s*([\d.]+)\s*$/,(_,a,b,v)=>{const key=s=>{s=s.replace(/^"|"$/g,'').replaceAll('""','"');if(!labels.has(s))labels.set(s,'MMNODE'+labels.size+'END');return labels.get(s);};return key(a)+','+key(b)+','+v;})).filter(l=>l.trim()).join('\n');}const flowModel=parseModel(input);let renderedEdges=[];if(flowModel.type==='flowchart'){const diagram=await mermaid.mermaidAPI.getDiagramFromText(input);renderedEdges=diagram.db.getEdges().map(e=>({id:e.id,start:e.start,end:e.end}));}const result=await mermaid.render(namespace+(++serial),input);let svg=result.svg;if(flowModel.type==='flowchart'){const doc=new DOMParser().parseFromString(svg,'image/svg+xml');annotateFlowEdges(doc.documentElement,flowModel,renderedEdges);svg=new XMLSerializer().serializeToString(doc.documentElement);}for(const [label,id] of labels)svg=svg.replaceAll(id,label.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])));send({svg,excluded,diagnostics});document.body.replaceChildren();return;}
  catch(err){const message=String(err?.message||err);let line=Number(err?.hash?.loc?.first_line||err?.hash?.line&&err.hash.line+1||message.match(/line\s+(\d+)/i)?.[1]||message.match(/\((\d+):\d+\)/)?.[1]);
   if(!Number.isFinite(line)||line<1||line>work.length)line=work.findIndex((s,i)=>i>0&&s.trim())+1;
   diagnostics.push({line,message:message.slice(0,1600)});if(!recover||line<=1){send({error:message,excluded,diagnostics});document.body.replaceChildren();return;}
   let at=line-1;if(!work[at]?.trim())at=work.findIndex((s,i)=>i>0&&s.trim());if(at<1)break;
   // 閉じ記号の場合は対応する開始行まで除外して、途中ブロックを残さない。
   let from=at,to=at;if(/^\s*(end|})\b/.test(work[at])){for(let i=at-1;i>0;i--)if(/\{|\b(subgraph|loop|alt|opt|par|box)\b/.test(work[i])){from=i;break;}}
   else if(/\{\s*$|^\s*(subgraph|loop|alt|opt|par|box)\b/.test(work[at])){for(let i=at+1;i<work.length;i++)if(/^\s*(end\b|})/.test(work[i])){to=i;break;}}
   for(let i=from;i<=to;i++){if(work[i].trim()){excluded.push(i+1);work[i]='';}}document.body.replaceChildren();
  }
 }
 send({error:'10秒以内に描画を回復できませんでした。',excluded,diagnostics});
});
parent.postMessage({kind:'renderer-ready'},parentOrigin);
