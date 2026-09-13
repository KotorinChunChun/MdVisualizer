import {mkdir,writeFile} from 'node:fs/promises';
import {catalog} from './catalog.js';
const root=new URL('./samples/',import.meta.url);await mkdir(root,{recursive:true});
for(const item of catalog)await writeFile(new URL(item.id+'.mmd',root),item.code+'\n');
console.log(`${catalog.length}種類のサンプルを生成しました。`);
