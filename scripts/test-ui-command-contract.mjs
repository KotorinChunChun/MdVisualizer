import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareInventory } from './ui-command-contract.mjs';
import { collectFile } from './ui-control-inventory.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-ui-contract-'));
try {
  const file = path.join(directory, 'Fixture.tsx');
  const scan = source => { fs.writeFileSync(file, source); return collectFile(file, 'desktop').map((r, i) => ({ ...r, id: `fixture-${i}` })); };
  const original = scan('export const A=()=> <div><button className="primary">保存</button><select aria-label="表示"><option>コード</option></select></div>');
  assert.equal(compareInventory(original, scan('\n\nexport const A=()=> <div><button className="primary">保存</button><select aria-label="表示"><option>コード</option></select></div>')).length, 0, '行追加だけでは署名を変えない');
  assert(compareInventory(original, scan('export const A=()=> <button>Save</button>')).length > 0, '名称変更/削除を検知');
  assert(compareInventory(original, [...original, { id: 'new', signature: 'x' }]).some(x => x.startsWith('未登録')), '新規操作を検知');
  assert(compareInventory(original, scan('export const A=()=> <div><button className="different">保存</button><select aria-label="表示"><option>コード</option></select></div>')).length > 0, 'デザイン属性の変更を検知');
  assert(scan('const menu=[{label:"保存",run:()=>save()},{label:"コピー",action:"copy"}];').every(r=>r.controlKind==='command-definition'), '動的生成メニューの定義を検知');
  assert.equal(scan('const menu=[{label:"保存",run:()=>save()},{label:"コピー",action:"copy"}];').length, 2);
  const html = path.join(directory, 'Fixture.html');
  fs.writeFileSync(html, '<main><button id="save">保存</button><dialog><button aria-label="閉じる">×</button></dialog></main>');
  const htmlRows = collectFile(html, 'shared');
  assert(htmlRows.some(row => row.displayName === '保存' && row.source.kind === 'shared'), '静的HTMLのボタンを検知');
  assert(htmlRows.some(row => row.controlKind === 'dialog'), '静的HTMLのダイアログを検知');
  const script = path.join(directory, 'Fixture.js');
  fs.writeFileSync(script, 'const markup = `<button>${name}</button><select><option>固定候補</option></select>`;');
  const scriptRows = collectFile(script, 'shared');
  assert(scriptRows.some(row => row.interactions.includes('html-template') && row.labelKind === 'dynamic'), 'HTMLテンプレートの動的表示を未展開で検知');
  assert(scriptRows.some(row => row.displayName === '固定候補'), 'HTMLテンプレートの静的選択肢を検知');
  console.log('UI対応表検査: 10境界成功（追加・削除・名称・デザイン・行移動・動的定義・静的HTML・テンプレート）');
} finally { fs.rmSync(directory, { recursive: true }); }
