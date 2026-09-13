// SVG原本からPNGと複数解像度ICOを再生成する。製品設定は変更しない。
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.ICON_SHARP_MODULE || 'sharp');
const root = __dirname;
const sizes = [16,20,24,30,32,40,44,48,50,60,64,71,80,89,96,107,128,142,150,176,192,200,256,284,300,310,512,600,620,1024];
const icoSizes = [16,20,24,32,40,48,64,96,128,256];
const glyph = {
 M:'M0 70V0l25 36L50 0v70',
 d:'M45 0v70H23C8 70 0 61 0 47s8-23 23-23h22',
 S:'M48 5H20C-4 5-4 34 20 35h10c26 0 26 35 0 35H0',
 V:'M0 0l25 70L50 0',
 G:'M50 10C38-5 0-5 0 35s38 40 50 25V38H28',
 D:'M0 70V0h20c40 0 40 70 0 70z',
 R:'M0 70V0h24c33 0 33 35 0 35H0m24 0 28 35',
 A:'M0 70 25 0l25 70M10 44h30',
 W:'M0 0 10 70 25 35 40 70 50 0',
 T:'M0 0h50M25 0v70'
};
const write = (name, data) => { const out=path.join(root,name); fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,data); };
function fileSvg(label) {
 const width=label.length*65-15;
 const scale=Math.min(1,174/(width+12));
 const x=(256-width*scale)/2;
 const letters=[...label].map((c,i)=>`<path transform="translate(${i*65} 0)" d="${glyph[c]}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><title>MdVisualizer ${label} ファイル</title><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#153c8a"/></linearGradient></defs><rect x="12" y="12" width="232" height="232" rx="48" fill="url(#g)"/><path d="M27 30h156l46 46v151H27z" fill="white"/><path d="M183 30v46h46" fill="#bfdbfe"/><path d="M47 195h112" stroke="#93c5fd" stroke-width="8"/><g transform="translate(${x} ${134-35*scale}) scale(${scale})" fill="none" stroke="#2563eb" stroke-width="11" stroke-linecap="square" stroke-linejoin="round">${letters}</g></svg>`;
}
async function main() {
 const originals = {app:fs.readFileSync(path.join(root,'../v0.0.16-mdvisualizer-icons/01.svg'),'utf8')};
 for(const [key,label] of Object.entries({md:'Md',svg:'SVG',drawio:'DRAW',mmd:'MMD',tsv:'TSV'})) originals[key]=fileSvg(label);
 const manifest=[];
 for(const [key,svg] of Object.entries(originals)) {
  write(`svg/${key}.svg`,svg);
  const frames=[];
  for(const size of sizes){const png=await sharp(Buffer.from(svg)).resize(size,size).png().toBuffer();write(`png/${key}/${size}.png`,png);if(icoSizes.includes(size))frames.push({size,png});manifest.push({file:`png/${key}/${size}.png`,width:size,height:size});}
  const header=Buffer.alloc(6+16*frames.length);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);let offset=header.length;
  frames.forEach(({size,png},i)=>{let p=6+16*i;header[p]=size===256?0:size;header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
  write(`ico/${key}.ico`,Buffer.concat([header,...frames.map(f=>f.png)]));
 }
 const app=Buffer.from(originals.app);
 for(const [name,base] of Object.entries({StoreLogo:50,Square44x44Logo:44,Square150x150Logo:150,Square71x71Logo:71,Square310x310Logo:310})){
  for(const scale of [100,125,150,200,400]){const size=Math.round(base*scale/100);write(`msix/${name}.scale-${scale}.png`,await sharp(app).resize(size,size).png().toBuffer());}
  write(`msix/${name}.png`,await sharp(app).resize(base,base).png().toBuffer());
 }
 for(const size of [16,20,24,30,32,36,40,48,60,64,72,80,96,256])for(const suffix of ['', '_altform-unplated'])write(`msix/Square44x44Logo.targetsize-${size}${suffix}.png`,await sharp(app).resize(size,size).png().toBuffer());
 write('store/app-icon-1024.png',await sharp(app).resize(1024,1024).png().toBuffer());
 let tiles=[];let i=0;
 for(const [key,svg]of Object.entries(originals)){const x=24+i%3*310,y=70+Math.floor(i/3)*290;tiles.push({input:await sharp(Buffer.from(svg)).resize(190).png().toBuffer(),left:x+50,top:y});const label=`<svg width="290" height="70"><text x="145" y="26" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#172033">${key==='app'?'MdVisualizer':{md:'Md / .md .markdown',svg:'SVG / .svg',drawio:'DRAW / .drawio',mmd:'MMD / .mmd .mermaid',tsv:'TSV / .tsv'}[key]}</text></svg>`;tiles.push({input:Buffer.from(label),left:x,top:y+195});for(const [j,s]of [16,24,32,48].entries())tiles.push({input:await sharp(Buffer.from(svg)).resize(s).png().toBuffer(),left:x+40+j*55,top:y+234+(48-s)/2});i++;}
 write('preview.png',await sharp({create:{width:960,height:670,channels:4,background:'#eef2f7'}}).composite(tiles).png().toBuffer());
 // 生成物の寸法、透過、ICOディレクトリと格納PNGを照合する。
 for(const row of manifest){const m=await sharp(path.join(root,row.file)).metadata();if(m.width!==row.width||m.height!==row.height||!m.hasAlpha)throw Error(row.file);}
 for(const key of Object.keys(originals)){const b=fs.readFileSync(path.join(root,`ico/${key}.ico`));for(let i=0;i<icoSizes.length;i++){const p=6+i*16,n=b.readUInt32LE(p+8),o=b.readUInt32LE(p+12);const m=await sharp(b.subarray(o,o+n)).metadata();if(m.width!==icoSizes[i]||m.height!==icoSizes[i])throw Error('ICO '+key);}}
 write('manifest.json',JSON.stringify({pngSizes:sizes,icoSizes,files:manifest},null,2)+'\n');
 console.log('生成・検証完了: SVG 6種、通常PNG 180点、ICO 6点、MSIX PNG 58点、Store PNG 1点');
}
main().catch(e=>{console.error(e);process.exit(1);});
