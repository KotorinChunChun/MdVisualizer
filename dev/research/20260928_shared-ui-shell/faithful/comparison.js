const target=document.getElementById('target');
const result=document.getElementById('result');
const baseline=document.getElementById('baseline');
const stage=document.getElementById('stage');
const width=document.getElementById('width');
const height=document.getElementById('height');
const theme=document.getElementById('theme');
const zoom=document.getElementById('zoom');
const php=document.getElementById('php');
function resize(){stage.style.width=`${width.value}px`;stage.style.height=`${height.value}px`;document.getElementById('metrics').textContent=`両画面の表示領域：${width.value} × ${height.value} CSS px`;}
function show(name){for(const [id,frame] of [['baseline',baseline],['result',result]]){const hidden=id!==name;frame.setAttribute('aria-hidden',String(hidden));frame.inert=hidden;document.getElementById(`show-${id}`).setAttribute('aria-pressed',String(!hidden));}}
function reload(){const query=new URLSearchParams({theme:theme.value,zoom:zoom.value});if(php.checked)query.set('php','1');baseline.src=`reference.html?${query}`;result.src=`faithful-${target.value}.html?${query}`;document.getElementById('standalone').href=`faithful-${target.value}.html?${query}`;}
document.getElementById('show-baseline').onclick=()=>show('baseline');
document.getElementById('show-result').onclick=()=>show('result');
document.getElementById('reset').onclick=reload;
for(const control of [target,theme,zoom,php])control.onchange=reload;
width.onchange=resize;height.onchange=resize;
resize();show('result');reload();
