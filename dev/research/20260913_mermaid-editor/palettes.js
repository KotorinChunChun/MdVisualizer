// 各サイトをイメージした試作版独自の配色。公式テーマではない。
export const palettes={
 github:{label:'GitHub風',fill:'#f6f8fa',stroke:'#57606a',text:'#24292f',line:'#57606a',background:'#ffffff'},
 githubDark:{label:'GitHub Dark風',fill:'#161b22',stroke:'#8b949e',text:'#f0f6fc',line:'#8b949e',background:'#0d1117'},
 qiita:{label:'Qiita風',fill:'#eff8e8',stroke:'#55a500',text:'#263321',line:'#55a500',background:'#ffffff'},
 zenn:{label:'Zenn風',fill:'#edf6ff',stroke:'#3ea8ff',text:'#243a50',line:'#527c9f',background:'#ffffff'},
 stackoverflow:{label:'Stack Overflow風',fill:'#fff4e8',stroke:'#e47720',text:'#3b4045',line:'#6a737c',background:'#ffffff'}
};
export function paletteVariables(id){const p=palettes[id];return {primaryColor:p.fill,primaryBorderColor:p.stroke,primaryTextColor:p.text,lineColor:p.line,background:p.background};}
export function selectedPalette(config){return Object.keys(palettes).find(id=>config.theme==='base'&&Object.entries(paletteVariables(id)).every(([k,v])=>config.themeVariables?.[k]===v))||config.theme||'default';}
