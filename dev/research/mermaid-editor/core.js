import {diagramType,catalog} from './catalog.js';
export const escapeRE=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function patch(source,changes){let last=source.length;for(const c of [...changes].sort((a,b)=>b.from-a.from)){if(c.to>last)throw Error('編集範囲が重なっています');source=source.slice(0,c.from)+c.text+source.slice(c.to);last=c.from;}return source;}
export function linesOf(source){let at=0;return source.split('\n').map((text,i)=>{const l={text:text.replace(/\r$/,''),from:at,to:at+text.length,line:i+1};at+=text.length+1;return l;});}
const flowTypes=['flowchart','swimlane','block'];
const networkTypes=[...flowTypes,'state','class','er','sequence','architecture','requirement','c4','sankey','wardley'];
const hierarchy=['mindmap','treeView','kanban','ishikawa','treemap'];
export function capabilities(type){return {connect:networkTypes.includes(type),group:[...flowTypes,'state','class','sequence','architecture','c4',...hierarchy,'gantt','timeline','journey'].includes(type),shape:flowTypes.includes(type)||type==='mindmap'||type==='architecture',color:[...flowTypes,'class','state','c4'].includes(type),note:['sequence','state','class'].includes(type),move:!['info','xychart','radar'].includes(type),add: type!=='info'};}
function flowToken(text,start=0){
 const m=/^(\[\*\]|(?:[\p{L}\p{N}_]|-(?=[\p{L}\p{N}_]))+)/u.exec(text.slice(start));if(!m)return null;
 const id=m[1];let end=start+m[0].length;const begin=end;
 const pairs=[['(((',')))'],['[[',']]'],['([','])'],['((', '))'],['{{','}}'],['[/', '/]'],['[\\','\\]'],['[',']'],['(',')'],['{','}'],['> ',']']];
 for(const [a,b] of pairs){if(text.startsWith(a,end)){let p=end+a.length,quote=false;for(;p<text.length;p++){if(text[p]==='"'&&text[p-1]!=='\\')quote=!quote;if(!quote&&text.startsWith(b,p))break;}if(p>=text.length)return null;end=p+b.length;return {id,start,end,raw:text.slice(start,end),label:text.slice(begin+a.length,p).replace(/^"|"$/g,''),shape:a,defined:true,labelStart:begin+a.length,labelEnd:p};}}
 return {id,start,end,raw:id,label:id,defined:false};
}
export function parseModel(source){
 const type=diagramType(source),lines=linesOf(source),nodes=new Map(),edges=[],groups=[];let safe=true;
 const add=(id,label,line,from,to,extra={})=>{if(!id||id==='[*]')return;const old=nodes.get(id);const ref={from,to,line:line.line};if(old){old.refs.push(ref);if(extra.defined){Object.assign(old,{label,from,to,line:line.line},extra);}}else nodes.set(id,{id,label,from,to,line:line.line,refs:[ref],...extra});};
 const stack=[];
 for(const line of lines){const s=line.text.trim(),offset=line.from+line.text.indexOf(s);const keyword=catalog.find(t=>t.id===type)?.code.split('\n')[0].split(' ')[0];if(!s||s.startsWith('%%')||line.line===1||s===keyword||s.startsWith(keyword+' ')||/^(flowchart|graph)\s+(LR|RL|TD|TB|BT)\b/.test(s))continue;
  let m;
  if(type==='sequence'&&(m=/^box\s+(.+)/.exec(s))){const g={id:'box-'+line.line,label:m[1],from:line.from,headerTo:line.to,line:line.line,members:[],parent:stack.at(-1)?.id};groups.push(g);stack.push(g);continue;}
  if(type==='c4'&&(m=/^(?:System_Boundary|Container_Boundary)\((\w+),\s*"([^"]*)"\)\s*\{/.exec(s))){const g={id:m[1],label:m[2],from:line.from,headerTo:line.to,line:line.line,members:[],parent:stack.at(-1)?.id};groups.push(g);stack.push(g);continue;}
  if((m=/^(?:subgraph|block:|namespace|state)\s*([\p{L}\p{N}_-]+)(?:\[([^\]]*)\]|\s*\{)?/u.exec(s))&&(/^(subgraph|block:|namespace)/.test(s)||/\{\s*$/.test(s))){const g={id:m[1],label:m[2]||m[1],from:line.from,headerTo:line.to,line:line.line,members:[],parent:stack.at(-1)?.id};groups.push(g);stack.push(g);continue;}
  if(/^(end|})\s*;?$/.test(s)){if(stack.length){const g=stack.pop();g.to=line.to;g.footerFrom=line.from;}continue;}
  if(flowTypes.includes(type)){
   if(/^(direction|style|classDef|class|click|linkStyle|columns|space|accTitle|accDescr|---|title|config|layout|theme)\b/.test(s)||s==='---')continue;
   let token=flowToken(s),cursor=token?.end||0,found=false;
   if(!token){safe=false;continue;}
   const addToken=t=>{add(t.id,t.label,line,offset+t.start,offset+t.end,{...t,from:offset+t.start,to:offset+t.end,line:line.line,labelFrom:t.labelStart===undefined?undefined:offset+t.labelStart,labelTo:t.labelEnd===undefined?undefined:offset+t.labelEnd,group:stack.at(-1)?.id});for(const g of stack)if(!g.members.includes(t.id))g.members.push(t.id);};
   addToken(token);
   while(cursor<s.length){
    const rest=s.slice(cursor);const edge=/^\s*(-->|---|==>|-\.->|--o|--x|<-->|<--|o--o|x--x)(?:\|([^|]*)\|)?\s*/.exec(rest);
    if(edge){const next=flowToken(s,cursor+edge[0].length);if(!next){safe=false;break;}addToken(next);edges.push({id:`edge-${line.line}-${cursor}`,from:token.id,to:next.id,arrow:edge[1],label:edge[2]||'',line:line.line,start:offset+token.start,end:offset+next.end,lineFrom:line.from,lineTo:line.to});token=next;cursor=next.end;found=true;}
    else if(/^\s*;?\s*$/.test(rest)||/^\s*%%/.test(rest)||/^:::\w+\s*$/.test(rest)){break;}
    else if(type==='block'&&/^\s+/.test(rest)){const n=flowToken(s,cursor+(rest.match(/^\s+/)?.[0].length||0));if(!n){safe=false;break;}addToken(n);cursor=n.end;token=n;}
    else {safe=false;break;}
   }
   continue;
  }
  if(['state','class','er','sequence'].includes(type)){
   if(type==='sequence'&&(m=/^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/.exec(s))){add(m[2],m[3]||m[2],line,offset,line.to,{defined:true,group:stack.at(-1)?.id});continue;}
   if(type==='class'&&(m=/^class\s+([\w-]+)(?:\["(.*)"\])?/.exec(s))){add(m[1],m[2]||m[1],line,offset,line.to,{defined:true});continue;}
   if(type==='state'&&(m=/^state\s+"([^"]+)"\s+as\s+(\w+)/.exec(s))){add(m[2],m[1],line,offset,line.to,{defined:true});continue;}
   if(type==='er'&&(m=/^([\w-]+)\s*\{/.exec(s))){add(m[1],m[1],line,offset,line.to,{defined:true});continue;}
   const re=type==='sequence'?/^(\w+)\s*(--?>>|--?>|--?x|--?\)|<<--?>>)[+-]?\s*(\w+)\s*:\s*(.*)$/:type==='er'?/^([\w-]+)\s+([|o}{]+[-.]{2}[|o}{]+)\s+([\w-]+)\s*:\s*(.*)$/:/^(\[\*\]|[\w-]+)\s*(<\|--|--\|>|\*--|o--|--> |-->|\.\.>|\.\.\|>|--|\.\.)\s*(\[\*\]|[\w-]+)(?:\s*:\s*(.*))?$/;
   if((m=re.exec(s))){add(m[1],m[1],line,offset,offset+m[1].length);const endAt=offset+s.indexOf(m[3],m[1].length+m[2].length);add(m[3],m[3],line,endAt,endAt+m[3].length);edges.push({id:`edge-${line.line}`,from:m[1],to:m[3],arrow:m[2].trim(),label:m[4]||'',line:line.line,start:offset,end:line.to,lineFrom:line.from,lineTo:line.to});for(const g of stack)g.members.push(m[1],m[3]);continue;}
  }
  const edgeRecord=(from,to,arrow,label,extra={})=>edges.push({id:`edge-${line.line}`,from,to,arrow,label,line:line.line,start:offset,end:line.to,lineFrom:line.from,lineTo:line.to,...extra});
  if(type==='architecture'&&(m=/^(\w+):([LTRB])\s*(--|<-->|-->|<--)\s*([LTRB]):(\w+)$/.exec(s))){edgeRecord(m[1],m[5],m[3],'',{fromPort:m[2],toPort:m[4]});continue;}
  if(type==='c4'&&(m=/^Rel\((\w+),\s*(\w+),\s*"([^"]*)"/.exec(s))){edgeRecord(m[1],m[2],'-->',m[3]);continue;}
  if(type==='requirement'&&(m=/^(\w+)\s*-\s*(\w+)\s*->\s*(\w+)/.exec(s))){edgeRecord(m[1],m[3],m[2],'');continue;}
  if(type==='wardley'&&(m=/^("[^"]+"|\S+)\s*->\s*("[^"]+"|\S+)\s*$/.exec(s))){edgeRecord(m[1].replace(/^"|"$/g,''),m[2].replace(/^"|"$/g,''),'->','');continue;}
  if(type==='sankey'&&(m=/^("[^"]+"|[^,]+),("[^"]+"|[^,]+),\s*([\d.]+)$/.exec(s))){const a=m[1].replace(/^"|"$/g,''),b=m[2].replace(/^"|"$/g,'');add(a,a,line,offset,offset+m[1].length,{csv:true});add(b,b,line,offset+m[1].length+1,offset+m[1].length+1+m[2].length,{csv:true});edgeRecord(a,b,'-->',m[3]);continue;}
  // 他の図種も項目のソース範囲を公開し、専用構文を保持したまま編集する。
  if(/^(title|accTitle|accDescr|dateFormat|axis|x-axis|y-axis|quadrant-[1-4]|showLegend|config|---|checkout|direction|classDef|class |style |click |linkStyle)\b/.test(s))continue;
  if(/^[+\-#~]?(?:String|int|string|float|boolean)\b/.test(s)||/^[+\-#~].*\(/.test(s))continue;
  let id=`line-${line.line}`,label=s;
  if((m=/^(?:service|group|junction)\s+(\w+)(?:\([^)]*\))?(?:\[([^\]]*)\])?/.exec(s))){id=m[1];label=m[2]||id;}
  else if((m=/^(?:Person|System|Container|Component|System_Boundary|Container_Boundary)\((\w+),\s*"([^"]*)"/.exec(s))){id=m[1];label=m[2];}
  else if((m=/^(?:requirement|element|functionalRequirement|performanceRequirement)\s+(\w+)/.exec(s))){id=m[1];label=id;}
  else if((m=/^(?:curve|set)\s+(\w+)\[([^\]]*)\]/.exec(s))){id=m[1];label=m[2].replaceAll('"','');}
  else if((m=/^([\w-]+)\[([^\]]*)\]/.exec(s))){id=m[1];label=m[2];}
  else if((m=/^"([^"]+)"/.exec(s)))label=m[1];
  else if((m=/^([^:]+)\s*:/.exec(s)))label=m[1].trim();
  else if((m=/^[\w-]+\(\(?([^)]*)\)/.exec(s)))label=m[1];
  if(/^section\s+/.test(s))label=s.replace(/^section\s+/,'');
  if(['gitGraph','packet','railroad','railroadEbnf','railroadAbnf','railroadPeg','eventmodeling'].includes(type)){const quoted=s.match(/["']([^"']+)["']/);if(quoted)label=quoted[1];}
  if(type==='wardley'&&(m=/^component\s+("[^"]+"|\S+)/.exec(s))){label=m[1].replace(/^"|"$/g,'');id=label;}
  if(type==='cynefin'){if(/^(clear|complex|complicated|chaotic|confused|disorder)\s*$/.test(s))continue;label=s.replace(/^"|"$/g,'');}
  if(type==='eventmodeling'&&/^entity\b/.test(s))continue;
  if(type==='architecture'&&/^group\b/.test(s)){groups.push({id,label,from:line.from,headerTo:line.to,line:line.line,architecture:true});continue;}
  add(id,label,line,offset,line.to,{record:true,indent:line.text.length-s.length,group:stack.at(-1)?.id,rawOnly:type==='xychart'});
 }
 // 複数行の定義は1項目として保持し、属性行を独立ノードと誤認しない。
 for(const n of [...nodes.values()]){const row=lines[n.line-1];if(/\{\s*$/.test(row.text)&&!flowTypes.includes(type)){let depth=1;for(let i=n.line;i<lines.length;i++){depth+=(lines[i].text.match(/\{/g)||[]).length-(lines[i].text.match(/}/g)||[]).length;if(depth<=0){n.blockTo=lines[i].to;n.blockEndLine=i+1;for(const other of [...nodes.values()])if(other.line>n.line&&other.line<=i+1)nodes.delete(other.id);break;}}}}
 if(hierarchy.includes(type)){for(const n of nodes.values()){const indent=lines[n.line-1].text.match(/^\s*/)[0].length;let end=n.line;for(;end<lines.length;end++){if(lines[end].text.trim()&&lines[end].text.match(/^\s*/)[0].length<=indent)break;}n.subtreeEnd=end;n.indent=indent;if(end>n.line)groups.push({id:n.id,label:n.label,from:lines[n.line-1].from,headerTo:lines[n.line-1].to,to:lines[end-1].to,line:n.line,hierarchy:true,members:[...nodes.values()].filter(c=>c.line>n.line&&c.line<=end).map(c=>c.id)});}}
 if(['gantt','timeline','journey'].includes(type)){for(const n of nodes.values())if(/^\s*section\b/.test(lines[n.line-1].text))groups.push({id:n.id,label:n.label,from:lines[n.line-1].from,headerTo:lines[n.line-1].to,line:n.line,section:true});}
 return {type,lines,nodes:[...nodes.values()],edges,groups,safe,source};
}
export function freshId(source,prefix='N'){let i=1;while(new RegExp(`\\b${prefix}${i}\\b`).test(source))i++;return prefix+i;}
function eol(source){return source.includes('\r\n')?'\r\n':'\n';}
function ensureNetwork(model){if(!networkTypes.includes(model.type))throw Error('この図種には接続操作がありません');if(flowTypes.includes(model.type)&&!model.safe)throw Error('複合記法を含むため、この操作はコード側で行ってください');}
export function edgeCode(type,e){const label=e.label||'';if(flowTypes.includes(type))return `${e.from} ${e.arrow||'-->'}${label?`|${label}|`:''} ${e.to}`;if(['sequence','state','class','er'].includes(type))return `${e.from} ${e.arrow||(type==='er'?'||--o{':type==='sequence'?'->>':'-->')} ${e.to}${label||['sequence','er'].includes(type)?' : '+(label||'接続'):''}`;if(type==='architecture')return `${e.from}:${e.fromPort||'R'} ${e.arrow||'--'} ${e.toPort||'L'}:${e.to}`;if(type==='c4')return `Rel(${e.from}, ${e.to}, "${label||'接続'}")`;if(type==='requirement')return `${e.from} - ${e.arrow||'satisfies'} -> ${e.to}`;if(type==='sankey')return `"${e.from}","${e.to}",${Number(label)||10}`;if(type==='wardley')return `"${e.from}" -> "${e.to}"`;throw Error('接続を作成できません');}
export function connect(source,from,to,arrow,label=''){const m=parseModel(source);ensureNetwork(m);if(m.edges.some(e=>e.from===from&&e.to===to&&e.label===label))return source;return source+eol(source)+'    '+edgeCode(m.type,{from,to,arrow,label});}
function rewriteEdges(model,nextEdges,removed=new Set()){
 const changes=[],nl=eol(model.source),touched=new Set(model.edges.map(e=>e.line));
 for(const line of model.lines){if(!touched.has(line.line))continue;
  const original=model.edges.filter(e=>e.line===line.line),replacement=nextEdges.filter(e=>e.line===line.line);
  if(original.length===replacement.length&&original.every((e,i)=>['from','to','arrow','label','fromPort','toPort'].every(k=>e[k]===replacement[i][k])))continue;
  const defs=flowTypes.includes(model.type)?model.nodes.filter(n=>n.defined&&!removed.has(n.id)&&n.line===line.line).map(n=>model.source.slice(n.from,n.to)):[];
  const comments=line.text.match(/\s*%%.*$/)?.[0]||'';
  const content=[...defs,...nextEdges.filter(e=>e.line===line.line).map(e=>edgeCode(model.type,e))];
  changes.push({from:line.from,to:line.to,text:content.map(t=>'    '+t).join(nl)+comments});
 }
 const newEdges=nextEdges.filter(e=>!touched.has(e.line));if(newEdges.length)changes.push({from:model.source.length,to:model.source.length,text:nl+newEdges.map(e=>'    '+edgeCode(model.type,e)).join(nl)});
 return patch(model.source,changes);
}
export function deleteNodes(source,ids){
 const m=parseModel(source),removed=new Set(ids),nl=eol(source);if(!ids.length)return source;
 if(hierarchy.includes(m.type)){const ls=source.split('\n');for(const n of m.nodes.filter(n=>removed.has(n.id)).sort((a,b)=>b.line-a.line)){const children=m.nodes.filter(c=>c.line>n.line&&c.line<=n.subtreeEnd);const childIndent=children.length?Math.min(...children.map(c=>c.indent)):n.indent+2;for(let i=n.line;i<n.subtreeEnd;i++)if(ls[i].trim())ls[i]=ls[i].slice(Math.max(0,childIndent-n.indent));ls[n.line-1]='';}let result=ls.filter((l,i)=>i===0||l.trim()).join('\n');if(['mindmap','ishikawa'].includes(m.type)){const rows=result.split('\n');if(rows.length>2){const firstIndent=rows[1].match(/^\s*/)[0].length;for(let i=2;i<rows.length;i++){const indent=rows[i].match(/^\s*/)[0].length;if(indent<=firstIndent){for(let j=i;j<rows.length;j++)rows[j]='  '+rows[j];break;}}result=rows.join('\n');}}return result;}
 if(!m.edges.length&&!flowTypes.includes(m.type)){const ranges=m.nodes.filter(n=>removed.has(n.id)).map(n=>({from:m.lines[n.line-1].from,to:n.blockTo??m.lines[n.line-1].to,text:''}));let result=patch(source,ranges);if(m.type==='venn')result=result.split('\n').filter(l=>!/^\s*union\b/.test(l)||!ids.some(id=>new RegExp(`\\b${escapeRE(id)}\\b`).test(l))).join('\n');if(m.type==='packet'){let at=0;result=result.split('\n').map(l=>l.replace(/^(\s*)(\d+)(?:-(\d+))?\s*:/,(_,space,a,b)=>{const width=Number(b??a)-Number(a);const first=at;at+=width+1;return `${space}${first}${width?'-'+(at-1):''}:`;})).join('\n');}if(m.type==='gitGraph'&&!/^\s*commit\b/m.test(result.split(/\bbranch\b/)[0]))result=result.replace(/^\s*merge\s+.*$/gm,'');return result;}
 ensureNetwork(m);const keep=m.edges.filter(e=>!removed.has(e.from)&&!removed.has(e.to));
 for(const first of m.edges.filter(e=>!removed.has(e.from)&&removed.has(e.to))){
  const walk=(id,labels,visited)=>{if(visited.has(id))return;const seen=new Set([...visited,id]);for(const e of m.edges.filter(e=>e.from===id)){const labels2=[...labels,...(e.label?[e.label]:[])];if(removed.has(e.to))walk(e.to,labels2,seen);else if(!keep.some(k=>k.from===first.from&&k.to===e.to)){keep.push({...first,to:e.to,label:[...new Set(labels2)].join(' / ')});}}};
  walk(first.to,first.label?[first.label]:[],new Set());
 }
 let result=rewriteEdges(m,keep,removed);let r=parseModel(result);const changes=[];
 for(const n of r.nodes.filter(n=>removed.has(n.id))){for(const ref of n.refs){if(flowTypes.includes(m.type)){changes.push({from:ref.from,to:ref.to,text:''});}else {const l=r.lines[ref.line-1];let end=l.to;if(/\{\s*$/.test(l.text)){let depth=1;for(let i=ref.line;i<r.lines.length;i++){depth+=(r.lines[i].text.match(/\{/g)||[]).length-(r.lines[i].text.match(/}/g)||[]).length;end=r.lines[i].to;if(depth<=0)break;}}changes.push({from:l.from,to:end,text:''});}}}
 const unique=changes.filter((c,i)=>changes.findIndex(x=>x.from===c.from&&x.to===c.to)===i);result=patch(result,unique);if(m.type==='sankey')result=result.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');return result;
}
export function moveNode(source,id,target,after=false){
 const m=parseModel(source);if(id===target)return source;
 if(!m.edges.length&&!flowTypes.includes(m.type)){
  const a=m.nodes.find(n=>n.id===id),b=m.nodes.find(n=>n.id===target);if(!a||!b)throw Error('移動する項目を選択してください');
  if(hierarchy.includes(m.type)){const stack=[],counts=new Map();for(const n of m.nodes){while(stack.length&&stack.at(-1).indent>=n.indent)stack.pop();const parent=stack.at(-1)?.id||'root';counts.set(parent,(counts.get(parent)||0)+1);stack.push(n);}if([...counts.values()].some(c=>c>1))throw Error('分岐を含む階層は並び替えできません');const order=[...m.nodes],moving=order.splice(order.findIndex(n=>n.id===id),1)[0];order.splice(order.findIndex(n=>n.id===target)+(after?1:0),0,moving);return patch(source,m.nodes.map((slot,i)=>({from:m.lines[slot.line-1].from,to:m.lines[slot.line-1].to,text:' '.repeat(slot.indent)+source.slice(order[i].from,order[i].to)})));}
  if(/[{}]|^(?:\s*)(section|group|block|loop|alt|par)\b/.test(m.lines[a.line-1].text)||hierarchy.includes(m.type))throw Error('階層を含む移動はコードで行ってください');
  const ls=source.split('\n'),[row]=ls.splice(a.line-1,1);const index=b.line-1-(a.line<b.line?1:0)+(after?1:0);ls.splice(index,0,row);return ls.join('\n');
 }
 ensureNetwork(m);const connected=new Set([id]);let changed=true;while(changed){changed=false;for(const e of m.edges)if(connected.has(e.from)||connected.has(e.to))for(const n of [e.from,e.to])if(!connected.has(n)){connected.add(n);changed=true;}}
 if(!connected.has(target))throw Error('同じ直列経路のノードへ移動してください');
 for(const n of connected)if(m.edges.filter(e=>e.from===n).length>1||m.edges.filter(e=>e.to===n).length>1)throw Error('分岐・合流を含む経路は並び替えできません');
 const start=[...connected].find(n=>!m.edges.some(e=>e.to===n));if(!start)throw Error('循環を含む経路は並び替えできません');
 const order=[],seen=new Set();let current=start;while(current){if(seen.has(current))throw Error('循環を含む経路は並び替えできません');seen.add(current);order.push(current);current=m.edges.find(e=>e.from===current)?.to;}
 order.splice(order.indexOf(id),1);order.splice(order.indexOf(target)+(after?1:0),0,id);
 const originals=m.edges.filter(e=>connected.has(e.from)),outside=m.edges.filter(e=>!connected.has(e.from));
 for(let i=0;i<order.length-1;i++){const old=originals.find(e=>e.from===order[i])||originals[i];outside.push({...old,from:order[i],to:order[i+1]});}
 return rewriteEdges(m,outside);
}
export function updateEdge(source,edgeId,values){const m=parseModel(source);ensureNetwork(m);return rewriteEdges(m,m.edges.map(e=>e.id===edgeId?{...e,...values}:e));}
export function updateNode(source,id,{label,shape,color,raw}){
 const m=parseModel(source),n=m.nodes.find(n=>n.id===id);if(!n)throw Error('項目を選択してください');
 if(raw!==undefined)return patch(source,[{from:n.from,to:n.to,text:raw}]);
 let result=source;
 if(label!==undefined){
  if(flowTypes.includes(m.type)){const shapes={rect:['[',']'],round:['(',')'],diamond:['{','}'],circle:['((', '))'],stadium:['([','])'],subroutine:['[[',']]']};let p=shapes[shape]||Object.values(shapes).find(([a])=>a===n.shape)||shapes.rect;const text=`${id}${p[0]}"${label.replaceAll('"','#quot;')}"${p[1]}`;const ref=n.defined?n:n.refs[0];result=patch(result,[{from:ref.from,to:ref.to,text}]);}
  else if(m.type==='sequence'){const line=m.lines[n.line-1];if(/\b(participant|actor)\b/.test(line.text))result=patch(result,[{from:line.from,to:line.to,text:`    participant ${id} as ${label}`}]);else result+='\n    participant '+id+' as '+label;}
  else if(m.type==='state'){if(n.defined)result=patch(result,[{from:n.from,to:n.to,text:`state "${label.replaceAll('"','')}" as ${id}`}]);else result+=`\n    state "${label.replaceAll('"','')}" as ${id}`;}
  else if(m.type==='class'){const line=m.lines[n.line-1];if(n.defined)result=patch(result,[{from:line.from,to:line.to,text:line.text.replace(new RegExp(`class\\s+${escapeRE(id)}(?:\\[".*?"\\])?`),`class ${id}["${label.replaceAll('"','')}"]`)}]);else result+=`\n    class ${id}["${label}"]`;}
  else if(m.type==='mindmap'&&shape){const raw=source.slice(n.from,n.to),prefix=raw.match(/^([\p{L}\p{N}_]+)(?=[\[({])/u)?.[1]||freshId(source),delimiters={rect:['[',']'],round:['(',')'],circle:['((', '))']};const pair=delimiters[shape]||delimiters.rect;result=patch(source,[{from:n.from,to:n.to,text:prefix+pair[0]+label.replace(/[\[\]{}()]/g,'')+pair[1]}]);}
  else if(m.type==='sankey'){const changes=n.refs.map(r=>({from:r.from,to:r.to,text:'"'+label.replaceAll('"','""')+'"'}));result=patch(source,changes);}
  else if(m.type==='requirement'){const end=n.blockTo||n.to,old=source.slice(n.from,end);const next=/\btext\s*:/.test(old)?old.replace(/(\btext\s*:)\s*[^\r\n]+/,`$1 "${label.replaceAll('"','')}"`):old.replace(/\{/,`{\n      docref: "${label.replaceAll('"','')}"`);result=patch(source,[{from:n.from,to:end,text:next}]);}
  else if(n.rawOnly){return source;}
  else {const old=source.slice(n.from,n.to);if(!old.includes(n.label))throw Error('コード欄で項目を編集してください');let next=old.replace(n.label,label);if(m.type==='architecture'){next=old.replace(/\[[^\]]*\]/,`["${label.replaceAll('"','')}"]`);if(shape&&['server','database','disk','cloud','internet'].includes(shape))next=next.replace(/\([^)]*\)/,'('+shape+')');}if(m.type==='wardley'){result=source.replace(new RegExp(`(?<![\\w"])${escapeRE(n.label)}(?![\\w"])`,'g'),'"'+label.replaceAll('"','')+'"');}else result=patch(result,[{from:n.from,to:n.to,text:next}]);}
 }
 if(color&&capabilities(m.type).color){if(!/^#[\da-f]{6}$/i.test(color))throw Error('色の形式が不正です');if(m.type==='c4')result+=`\n    UpdateElementStyle(${id}, $bgColor="${color}", $fontColor="#172033")`;else result+=`\n    ${m.type==='state'?'classDef':'style'} ${m.type==='state'?'paint_'+id:id} fill:${color},stroke:#334155,color:#172033`+(m.type==='state'?`\n    class ${id} paint_${id}`:'');}
 return result;
}
export function addNode(source,label='新しい項目',from){const m=parseModel(source),id=freshId(source);const template=catalog.find(t=>t.id===m.type)?.insert;if(!template)throw Error('この図種には項目追加がありません');let code=template.replace(/\bN\b/g,id).replaceAll('項目',label.replaceAll('"',''));if(m.type==='packet'){const max=Math.max(-1,...[...source.matchAll(/^\s*(\d+)(?:-(\d+))?\s*:/gm)].map(x=>Number(x[2]??x[1])));code=`${max+1}-${max+16}: "${label}"`;}if(m.type==='eventmodeling'){const max=Math.max(0,...[...source.matchAll(/\b(?:tf|rf)\s+(\d+)/g)].map(x=>Number(x[1])));code=`tf ${max+1} evt Order "${label}"`;}let result=source+eol(source)+'    '+code;
 if(from&&networkTypes.includes(m.type))result=connect(result,from,id);return {source:result,id};}
export function groupNodes(source,ids,label='グループ'){
 const m=parseModel(source),chosen=m.nodes.filter(n=>ids.includes(n.id));if(!chosen.length)throw Error('グループに入れる項目を選択してください');
 const id=freshId(source,'G'),nl=eol(source);let head,tail;
 if(flowTypes.includes(m.type)){head=m.type==='block'?`block:${id}`:`subgraph ${id}["${label.replaceAll('"','')}"]`;tail='end';}
 else if(m.type==='state'){head=`state ${id} {`;tail='}';}
 else if(m.type==='class'){head=`namespace ${label.replace(/[^\p{L}\p{N}_]/gu,'_')||id} {`;tail='}';}
 else if(m.type==='sequence'){head=`box ${label}`;tail='end';}
 else if(m.type==='architecture'){const changes=chosen.map(n=>({from:n.from,to:n.to,text:source.slice(n.from,n.to).replace(/\s+in\s+\w+\s*$/,'')+' in '+id}));return patch(source,changes)+nl+`group ${id}(cloud)["${label}"]`+nl;}
 else if(m.type==='c4'){head=`System_Boundary(${id}, "${label.replaceAll('"','')}") {`;tail='}';}
 else if(hierarchy.includes(m.type)||['gantt','timeline','journey'].includes(m.type)){const min=Math.min(...chosen.map(n=>n.line)),max=Math.max(...chosen.map(n=>n.line));const ls=source.split('\n');if(hierarchy.includes(m.type)){const indent=Math.min(...chosen.map(n=>n.indent||0));for(let i=min-1;i<max;i++)ls[i]='  '+ls[i];ls.splice(min-1,0,' '.repeat(indent)+(m.type==='treemap'?`"${label}"`:m.type==='kanban'||m.type==='treeView'?`${id}[${label}]`:label));}else ls.splice(min-1,0,'    section '+label);return ls.join('\n');}
 else throw Error('このグループ構文はコードから編集してください');
 if(m.type==='flowchart')return relocateFlowNodes(source+nl+'    '+head+nl+'    '+tail,ids,id);
 if(flowTypes.includes(m.type)){
  ensureNetwork(m);let normalized=rewriteEdges(m,m.edges);const fresh=parseModel(normalized),moves=[],defs=[];
  for(const n of fresh.nodes.filter(n=>ids.includes(n.id))){if(n.defined){defs.push(normalized.slice(n.from,n.to));moves.push({from:n.from,to:n.to,text:n.id});}else defs.push(n.id);}
  normalized=patch(normalized,moves);return normalized+nl+'    '+head+nl+defs.map(s=>'        '+s).join(nl)+nl+'    '+tail;
 }
 const min=Math.min(...chosen.map(n=>n.line)),max=Math.max(...chosen.map(n=>n.blockEndLine||n.line));const ls=source.split('\n');ls.splice(max,0,'    '+tail);ls.splice(min-1,0,'    '+head);return ls.join('\n')+(m.type==='state'?`\n    state "${label.replaceAll('"','')}" as ${id}`:'');
}
export function ungroup(source,groupId){const m=parseModel(source),g=m.groups.find(g=>g.id===groupId);if(!g)throw Error('解除するグループを選択してください');if(g.architecture){return patch(source,[{from:g.from,to:g.headerTo,text:''}]).replace(new RegExp(`\\s+in\\s+${escapeRE(g.id)}(?=\\s*(?:\\n|$))`,'g'),'');}if(g.hierarchy)return deleteNodes(source,[g.id]);if(g.section)return patch(source,[{from:g.from,to:g.headerTo,text:''}]);if(g.to===undefined)throw Error('グループの終端を確認してください');return patch(source,[{from:g.from,to:g.headerTo,text:''},{from:g.footerFrom,to:g.to,text:''}]);}
export function moveIntoGroup(source,ids,target){
 if(parseModel(source).type==='flowchart')return relocateFlowNodes(source,ids,target);
 const m=parseModel(source);if(!flowTypes.includes(m.type)&&m.type!=='architecture')throw Error('この図種のグループ移動は項目の記法から行ってください');
 if(m.type==='architecture'){return patch(source,m.nodes.filter(n=>ids.includes(n.id)).map(n=>({from:n.from,to:n.to,text:source.slice(n.from,n.to).replace(/\s+in\s+\w+\s*$/,'')+(target?' in '+target:'')})));}
 ensureNetwork(m);let changes=[],defs=[];const group=m.groups.find(g=>g.id===target);if(target&&!group)throw Error('移動先グループがありません');
 for(const n of m.nodes.filter(n=>ids.includes(n.id))){const parent=m.groups.find(g=>g.id===n.group);if(group&&group.members.includes(n.id)&&n.group===target)continue;
  const standalone=n.refs.find(r=>m.lines[r.line-1].text.trim()===source.slice(r.from,r.to).trim());const def=n.defined?source.slice(n.from,n.to):n.id;
  if(standalone){changes.push({from:standalone.from,to:standalone.to,text:''});if(n.defined&&standalone.from!==n.from)changes.push({from:n.from,to:n.to,text:n.id});}
  else if(n.defined)changes.push({from:n.from,to:n.to,text:n.id});
  if(parent&&!standalone)throw Error('接続行を含む所属変更はコードで行ってください');defs.push(def);
 }
 if(!defs.length)return source;const pos=group?group.footerFrom:source.length;changes.push({from:pos,to:pos,text:eol(source)+defs.map(t=>'    '+t).join(eol(source))+eol(source)});return patch(source,changes);
}
export function editGroup(source,id,label,parentId,direction){const m=parseModel(source),g=m.groups.find(g=>g.id===id);if(!g)throw Error('グループがありません');if(parentId===id)throw Error('自分自身を親にできません');let text=source.slice(g.from,g.to??g.headerTo);if(g.architecture){text=text.replace(/\[[^\]]*\]/,`["${label.replaceAll('"','')}"]`).replace(/\s+in\s+\w+\s*$/,'')+(parentId?' in '+parentId:'');return patch(source,[{from:g.from,to:g.headerTo,text}]);}
 if(m.type==='flowchart'||m.type==='swimlane'){text=text.replace(/^\s*subgraph[^\n]*/,`    subgraph ${id}["${label.replaceAll('"','')}"]`);if(direction){text=text.replace(/^\s*direction\s+(TB|TD|BT|LR|RL)\s*$/m,'');text=text.replace(/\n/,eol(source)+'        direction '+direction+eol(source));}}
 if(parentId===undefined||parentId===g.parent)return patch(source,[{from:g.from,to:g.to,text}]);const parent=m.groups.find(x=>x.id===parentId);if(parent&&parent.from>=g.from&&parent.to<=g.to)throw Error('子グループの中には移動できません');const pos=parent?parent.footerFrom:source.length;return patch(source,[{from:g.from,to:g.to,text:''},{from:pos,to:pos,text:eol(source)+text+eol(source)}]);}
export function addComment(source,ids,text,note=false){const m=parseModel(source),n=m.nodes.find(n=>ids.includes(n.id)),nl=eol(source);let insertion=text.split(/\r?\n/).map(t=>'%% '+t).join(nl);if(note&&n){if(m.type==='sequence')insertion=`Note over ${n.id}: ${text.replaceAll('\n','<br/>')}`;else if(m.type==='state')insertion=`note right of ${n.id}\n${text}\nend note`;else if(m.type==='class')insertion=`note for ${n.id} "${text.replaceAll('"','').replaceAll('\n','\\n')}"`;}
 const pos=n?m.lines[n.line-1].to:source.length;return patch(source,[{from:pos,to:pos,text:nl+'    '+insertion}]);}
export function selectedIds(model,from,to){return model.nodes.filter(n=>n.refs.some(r=>from===to?r.from<=from&&from<=r.to:r.from<to&&r.to>from)).map(n=>n.id);}

// 接続行をグループの外へ分離し、所属をノード定義の位置だけで管理する。
export function relocateFlowNodes(source,ids,target){
 const m=parseModel(source);ensureNetwork(m);const group=m.groups.find(g=>g.id===target);if(target&&!group)throw Error('移動先グループがありません');
 const chosen=m.nodes.filter(n=>ids.includes(n.id));if(chosen.length!==new Set(ids).size)throw Error('移動するノードが見つかりません');
 const changes=[],edgeLines=new Set(m.edges.map(e=>e.line));
 for(const line of m.lines){if(!edgeLines.has(line.line))continue;const defs=m.nodes.filter(n=>n.line===line.line&&!ids.includes(n.id)).map(n=>source.slice(n.from,n.to));const comment=line.text.match(/\s*%%.*$/)?.[0]||'';changes.push({from:line.from,to:line.to,text:defs.map(d=>'    '+d).join('\n')+comment});}
 for(const n of chosen)for(const r of n.refs)if(!edgeLines.has(r.line))changes.push({from:r.from,to:r.to,text:''});
 const defs=chosen.map(n=>n.defined?source.slice(n.from,n.to):n.id),pos=group?group.footerFrom:source.length;
 if(pos===undefined)throw Error('グループの終端が不明です');
 changes.push({from:pos,to:pos,text:'\n'+defs.map(d=>'    '+d).join('\n')+'\n'});
 let result=patch(source,changes);if(m.edges.length)result+='\n'+m.edges.map(e=>'    '+edgeCode(m.type,e)).join('\n');return result;
}
export function addFlowNode(source,label,from,mode='branch',target){
 const m=parseModel(source);ensureNetwork(m);const outgoing=m.edges.filter(e=>e.from===from);let result=addNode(source,label).source;const id=parseModel(result).nodes.find(n=>!m.nodes.some(old=>old.id===n.id))?.id;
 if(!id)throw Error('追加したノードを確認できません');
 if(from){if(mode==='insert'&&outgoing.length){const e=outgoing.find(e=>e.id===target)||outgoing[0];result=updateEdge(result,e.id,{to:id});result=connect(result,id,e.to,e.arrow,'');}else result=connect(result,from,id);const parent=m.nodes.find(n=>n.id===from)?.group;if(parent)result=moveIntoGroup(result,[id],parent);}
 return {source:result,id};
}
export function renameFlowIds(source,rows){
 const m=parseModel(source);if(m.type!=='flowchart')throw Error('変数名の一括変更はフローチャートで利用できます');ensureNetwork(m);
 const items=[...m.nodes,...m.groups].filter((n,i,a)=>a.findIndex(x=>x.id===n.id)===i),map=new Map(rows.map(r=>[r.id,r.next]));
 if(rows.length!==items.length||map.size!==items.length||items.some(n=>!map.has(n.id)))throw Error('変数一覧に漏れまたは重複があります');
 const reserved=new Set(['end','subgraph','flowchart','graph','direction','style','class','classDef','click','linkStyle','default']);
 for(const next of map.values())if(!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(next)||reserved.has(next))throw Error('使用できない変数名です: '+next);
 if(new Set(map.values()).size!==map.size)throw Error('変更後の変数名が重複しています');
 const changes=[],seen=new Set(),add=(from,to,id)=>{if(!map.has(id)||seen.has(from))return;seen.add(from);changes.push({from,to,text:map.get(id)});};
 for(const n of m.nodes)for(const r of n.refs)add(r.from,r.from+n.id.length,n.id);
 for(const g of m.groups){const line=m.lines[g.line-1],offset=line.text.indexOf(g.id,line.text.indexOf('subgraph')+8);add(line.from+offset,line.from+offset+g.id.length,g.id);}
 // IDを取る命令の引数だけを変更し、ラベル・コメント・URL・classDefを保持する。
 for(const l of m.lines){const match=/^(\s*)(style|class|click)\s+([\p{L}\p{N}_,-]+)/u.exec(l.text);if(match){const start=l.from+match[0].length-match[3].length;for(const token of match[3].matchAll(/[\p{L}\p{N}_-]+/gu))add(start+token.index,start+token.index+token[0].length,token[0]);}}
 const result=patch(source,changes),after=parseModel(result);if(items.some(n=>![...after.nodes,...after.groups].some(a=>a.id===map.get(n.id))))throw Error('変更後の変数一覧を確認できません');return result;
}
