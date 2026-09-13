import {parseModel,deleteNodes,connect,updateEdge,moveIntoGroup,editGroup,renameFlowIds,edgeCode,escapeRE} from './core.js';

function flow(source){const m=parseModel(source);if(m.type!=='flowchart'||!m.safe)throw Error('この操作は基本記法のフローチャートで利用できます');return m;}
function definition(m,n){return n.defined?m.source.slice(n.from,n.to):`${n.id}["${n.label.replaceAll('"','#quot;')}"]`;}
export function copyFlow(source,ids=[],groupId){
 const m=flow(source),group=m.groups.find(g=>g.id===groupId);
 const groups=group?m.groups.filter(g=>g.from>=group.from&&g.to<=group.to):[];
 const chosen=m.nodes.filter(n=>group?group.members.includes(n.id):ids.includes(n.id));
 if(!chosen.length)throw Error('コピーするノードまたはグループを選択してください');
 const selected=new Set(chosen.map(n=>n.id)),groupIds=new Set(groups.map(g=>g.id)),lines=['flowchart LR'];
 const emit=parent=>{for(const n of chosen.filter(n=>(groupIds.has(n.group)?n.group:undefined)===parent))lines.push('    '+definition(m,n));for(const g of groups.filter(g=>(groupIds.has(g.parent)?g.parent:undefined)===parent)){lines.push(source.slice(g.from,g.headerTo));const dir=source.slice(g.headerTo,g.footerFrom).match(/^\s*direction\s+(LR|RL|TB|TD|BT)\s*$/m);if(dir)lines.push(dir[0]);emit(g.id);lines.push('    end');}};
 emit(undefined);
 for(const e of m.edges.filter(e=>selected.has(e.from)&&selected.has(e.to)))lines.push('    '+edgeCode(m.type,e));
 for(const l of m.lines){if(/^\s*classDef\s/.test(l.text))lines.push(l.text);const style=/^\s*(style|class)\s+([^\s]+)\s+(.+)$/.exec(l.text);if(style){const targets=style[2].split(',').filter(id=>selected.has(id)||groupIds.has(id));if(targets.length)lines.push(`    ${style[1]} ${targets.join(',')} ${style[3]}`);}}
 return lines.join('\n');
}
export function pasteFlow(source,clipboard,anchor){
 const m=flow(source),copied=flow(clipboard),all=[...copied.nodes,...copied.groups].filter((n,i,a)=>a.findIndex(x=>x.id===n.id)===i),used=new Set([...m.nodes,...m.groups].map(n=>n.id));
 const rows=all.map(n=>{const prefix=copied.groups.some(g=>g.id===n.id)?'G':'N';let i=1;while(used.has(prefix+i)||new RegExp(`\\b${prefix}${i}\\b`).test(source))i++;const next=prefix+i;used.add(next);return {id:n.id,next};});
 const renamed=renameFlowIds(clipboard,rows),next=flow(renamed);let result=source+'\n'+renamed.split('\n').slice(1).join('\n');
 const entries=next.nodes.filter(n=>!next.edges.some(e=>e.to===n.id)),exits=next.nodes.filter(n=>!next.edges.some(e=>e.from===n.id));
 if(anchor){if(!m.nodes.some(n=>n.id===anchor))throw Error('貼り付け先がありません');const incoming=entries.length?entries:[next.nodes[0]],outgoing=m.edges.filter(e=>e.from===anchor);
  if(outgoing.length===1&&entries.length&&exits.length){result=updateEdge(result,outgoing[0].id,{to:incoming[0].id});for(const n of incoming.slice(1))result=connect(result,anchor,n.id);for(const n of exits)result=connect(result,n.id,outgoing[0].to,outgoing[0].arrow);}
  else for(const n of incoming)result=connect(result,anchor,n.id);
  const parent=m.nodes.find(n=>n.id===anchor).group;
  if(parent){const loose=next.nodes.filter(n=>!n.group).map(n=>n.id);if(loose.length)result=moveIntoGroup(result,loose,parent);for(const g of next.groups.filter(g=>!g.parent))result=editGroup(result,g.id,g.label.replace(/^"|"$/g,''),parent);}
 }
 return result;
}
export function moveToRoot(source,ids){const m=flow(source);if(!ids.length)return source;const keep=copyFlow(source,ids);return deleteNodes(source,ids)+'\n'+keep.split('\n').slice(1).filter(l=>!/^\s*(style|class|classDef)\s/.test(l)).join('\n');}
export function nodeColors(source,id){const colors={fill:'#e8efff',stroke:'#334155',color:'#172033'};for(const l of source.split('\n')){const m=/^\s*style\s+(\S+)\s+(.+)$/.exec(l);if(m&&m[1].split(',').includes(id))for(const part of m[2].split(',')){const [key,value]=part.split(':');if(key in colors&&/^#[\da-f]{6}$/i.test(value))colors[key]=value;}}return colors;}
export function styleNode(source,id,values){flow(source);const props=[];for(const [key,value] of Object.entries(values)){if(!['fill','stroke','color'].includes(key))continue;if(!/^#[\da-f]{6}$/i.test(value))throw Error('色の形式が不正です');props.push(key+':'+value);}return props.length?source+`\n    style ${id} ${props.join(',')}`:source;}
export function styleEdge(source,edgeId,stroke,color){const m=flow(source),index=m.edges.findIndex(e=>e.id===edgeId);if(index<0)throw Error('接続がありません');for(const v of [stroke,color])if(!/^#[\da-f]{6}$/i.test(v))throw Error('色の形式が不正です');return source+`\n    linkStyle ${index} stroke:${stroke},color:${color}`;}
export function diagramDirection(source,nodeId){const m=parseModel(source),n=m.nodes.find(n=>n.id===nodeId);let g=m.groups.find(g=>g.id===n?.group);while(g){const body=source.slice(g.headerTo,g.footerFrom),dir=body.match(/^\s*direction\s+(LR|RL|TD|TB|BT)\s*$/m);if(dir)return dir[1];g=m.groups.find(x=>x.id===g.parent);}return source.match(/(?:flowchart|graph)\s+(LR|RL|TD|TB|BT)\b/)?.[1]||'TD';}
const initPattern=/%%\{\s*init\s*:\s*([\s\S]*?)\}%%/;
export function themeConfig(source){const match=source.match(initPattern);if(!match)return {};try{return JSON.parse(match[1]);}catch{throw Error('既存のinit設定がJSON形式ではありません。コード側で設定を確認してください');}}
export function setTheme(source,theme,variables={}){if(!['default','neutral','dark','forest','base'].includes(theme))throw Error('不明なテーマです');if(/^---\s*\n/.test(source))throw Error('YAML設定のテーマはコード側で変更してください');const config=themeConfig(source);config.theme=theme;config.themeVariables={...config.themeVariables,...variables};const directive='%%{init: '+JSON.stringify(config)+'}%%';return initPattern.test(source)?source.replace(initPattern,directive):directive+'\n'+source;}
