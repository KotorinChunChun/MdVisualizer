export const sequenceArrows=['->>','-->>','->','-->','-x','--x','-)','--)','<<->>','<<-->>'];
export function sequenceModel(source){const lines=[];let at=0;source.split('\n').forEach((text,i)=>{lines.push({text:text.replace(/\r$/,''),from:at,to:at+text.length,line:i+1});at+=text.length+1;});const participants=new Map(),notes=[],edges=[],groups=[],blocks=[];let safe=true;
const add=(id,line,from,to,extra={})=>{let n=participants.get(id);const ref={from,to,line:line.line};if(!n){n={id,label:id,from,to,line:line.line,refs:[],kind:'participant'};participants.set(id,n);}n.refs.push(ref);if(extra.defined)Object.assign(n,{from,to,line:line.line},extra);};
for(const l of lines){const s=l.text.trim(),offset=l.from+l.text.indexOf(s);let m;if(!s||s.startsWith('%%')||s==='sequenceDiagram')continue;
if((m=/^(participant|actor)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+(.+))?$/.exec(s))){const idFrom=offset+s.indexOf(m[2],m[1].length);const group=blocks.findLast(b=>b.kind==='box')?.group;add(m[2],l,idFrom,idFrom+m[2].length,{defined:true,label:m[3]||m[2],draw:m[1],definitionFrom:l.from,definitionTo:l.to,group:group?.id});group?.members.push(m[2]);continue;}
if((m=/^([A-Za-z_][A-Za-z0-9_]*)\s*(<<--?>>|--?>>|--?>|--?x|--?\))([+-]?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(s))){const b=offset+s.indexOf(m[4],m[1].length+m[2].length+m[3].length);add(m[1],l,offset,offset+m[1].length);add(m[4],l,b,b+m[4].length);edges.push({id:'edge-'+l.line,from:m[1],to:m[4],arrow:m[2],activation:m[3],label:m[5],line:l.line,start:offset,end:l.to,lineFrom:l.from,lineTo:l.to});continue;}
if((m=/^Note\s+(over|left of|right of)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*([A-Za-z_][A-Za-z0-9_]*))?\s*:\s*(.*)$/i.exec(s))){const ids=[m[2],m[3]].filter(Boolean);let cursor=s.indexOf(m[2]);for(const id of ids){const p=s.indexOf(id,cursor);add(id,l,offset+p,offset+p+id.length);cursor=p+id.length;}notes.push({id:'note-'+l.line,kind:'note',label:m[4],placement:m[1].toLowerCase(),actors:ids,from:l.from,to:l.to,line:l.line,refs:[{from:l.from,to:l.to,line:l.line}]});continue;}
if((m=/^box(?:\s+(.+))?$/.exec(s))){const g={id:'box-'+l.line,label:m[1]||'グループ',from:l.from,headerTo:l.to,line:l.line,members:[]};groups.push(g);blocks.push({kind:'box',group:g});continue;}
if(/^(loop|alt|opt|par|critical|break|rect)\b/.test(s)){blocks.push({kind:s.split(/\s/)[0]});continue;}
if(s==='end'){const b=blocks.pop();if(!b)safe=false;else if(b.group){b.group.to=l.to;b.group.footerFrom=l.from;}continue;}
if((m=/^(activate|deactivate)\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(s))){const p=offset+s.lastIndexOf(m[2]);add(m[2],l,p,p+m[2].length);continue;}
if(/^(autonumber(?:\s+.*)?|title\s+.*|accTitle:.*|else(?:\s+.*)?|and(?:\s+.*)?|option(?:\s+.*)?)$/.test(s))continue;
// 未対応構文を図のノードに変換しない。編集前にコードで確認してもらう。
safe=false;
}if(blocks.length)safe=false;return {type:'sequence',source,lines,nodes:[...participants.values(),...notes],notes,edges,groups,safe};}
