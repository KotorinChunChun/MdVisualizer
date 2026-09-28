import { JSDOM, VirtualConsole } from '../../../node_modules/jsdom/lib/api.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

for (const host of ['all', 'desktop', 'web', 'spfx']) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(await readFile(new URL(`./dist/${host === 'all' ? 'master' : `master-${host}`}.html`, import.meta.url), 'utf8'), {
    runScripts:'dangerously', virtualConsole: console,
    beforeParse(window) {
      // jsdomはネイティブdialog API未実装。内容と接続だけを検査する。
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
    },
  });
  try {
    const d = dom.window.document;
    const ui = () => d.getElementById('generated-ui');
    const control = id => ui().querySelector(`[data-action="${id}"]`);
    const change = (id, value) => { const el = d.getElementById(id); el.value = value; el.dispatchEvent(new dom.window.Event('change', {bubbles:true})); };
    const toggle = id => d.getElementById(id).click();
    assert.equal(d.getElementById('platform').value, host);
    assert.equal(Boolean(control('desktop.ai')), host === 'all' || host === 'desktop');
    assert.equal(Boolean(control('spfx.files')), host === 'all' || host === 'spfx');
    assert.equal(Boolean(control('web.zip')), host === 'all' || host === 'web');
    change('platform', 'web');
    assert.equal(control('desktop.ai'), null);
    assert.equal(control('spfx.files'), null);
    assert.equal(control('php.store'), null);
    toggle('php'); assert.ok(control('php.store'));
    toggle('readonly');
    for (const write of ui().querySelectorAll('[data-write]')) assert.equal(write.disabled, true);
    assert.equal(control('document.open').disabled, false);
    change('block-format', 'ps1'); assert.equal(control('powershell.run'), null);
    change('platform', 'desktop'); assert.ok(control('powershell.run'));
    assert.equal(control('php.store'), null);
    assert.equal(control('web.zip'), null);
    change('block-format', 'table'); assert.equal(control('powershell.run'), null); assert.ok(control('table.slicer')); assert.equal(control('table.header'), null);
    change('block-format', 'csv'); assert.ok(control('table.header'));
    change('platform','spfx'); assert.equal(control('copy.bitmap'), null); assert.equal(control('file.folder'), null); assert.equal(control('desktop.ai'), null);
    for (const node of ui().querySelectorAll('[data-platforms]')) assert.ok(node.dataset.platforms.split(' ').includes('spfx'));
    for (const group of ui().querySelectorAll('[data-group]')) assert.ok(group.querySelector('button,input,select,textarea'), group.dataset.group);
    control('view.code').click(); assert.equal(ui().querySelector('.master-preview').hidden, true);
    control('view.visual').click(); assert.equal(ui().querySelector('.master-code').hidden, true);
    control('view.split').click(); assert.equal(ui().querySelector('.master-code').hidden, false);
    control('dialog.table').click();
    assert.equal(d.getElementById('sample-dialog').open, true);
    assert.ok(d.getElementById('dialog-body').querySelector('table'));
    d.getElementById('close-dialog').click();
    assert.equal(d.getElementById('sample-dialog').open, false);
    const inventory = JSON.parse(d.getElementById('inventory-data').textContent);
    assert.ok(inventory.length > 1000);
    assert.equal(d.getElementById('inventory-rows').children.length, inventory.length);
    d.getElementById('inventory-search').value = 'SharePoint';
    d.getElementById('inventory-search').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
    assert.ok(d.getElementById('inventory-rows').children.length > 0);
    assert.ok(d.getElementById('inventory-rows').children.length < inventory.length);
    assert.deepEqual(errors, []);
    globalThis.console.log(`${host}: 環境属性・PHP能力・権限・形式・空グループ・表示切替・全操作目録 OK`);
  } finally { dom.window.close(); }
}
