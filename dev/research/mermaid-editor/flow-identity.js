// 表示文字は識別に使用しない。Mermaidが付加するSVG名前空間のみ除去する。
export function localSvgId(svg,element){const id=element.id||'';return id.startsWith(svg.id+'-')?id.slice(svg.id.length+1):id;}
export function bindFlowIdentity(svg,model){
 for(const el of svg.querySelectorAll('g.node')){const id=localSvgId(svg,el);const n=model.nodes.find(n=>id===n.id||id.startsWith('flowchart-'+n.id+'-')&&/^\d+$/.test(id.slice(('flowchart-'+n.id+'-').length)));if(n){el.dataset.item=n.id;el.setAttribute('tabindex','0');el.setAttribute('aria-label',`${n.label} (${n.id})`);}}
 for(const el of svg.querySelectorAll('g.cluster')){const id=localSvgId(svg,el),g=model.groups.find(g=>g.id===id);if(g){el.dataset.group=g.id;el.setAttribute('tabindex','0');el.setAttribute('aria-label',`${g.label} (${g.id})`);}}
}
