import { JSDOM, VirtualConsole } from '../../../node_modules/jsdom/lib/api.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const settle = () => new Promise(resolve => setTimeout(resolve, 40));
for (const host of ['desktop', 'web', 'spfx']) {
  const failures = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => failures.push(error.message));
  const html = await readFile(new URL(`./dist/${host}.html`, import.meta.url), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
  try {
    await settle();
    const document = dom.window.document;
    const buttons = () => [...document.querySelectorAll('button')];
    const button = text => buttons().find(item => item.textContent === text);
    const select = (label, value) => {
      const element = document.querySelector(`select[aria-label="${label}"]`);
      assert.ok(element, label); element.value = value;
      element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    };
    assert.equal(document.querySelector('select[aria-label="環境"]').value, host);
    assert.equal(Boolean(button('AI')), host === 'desktop');
    assert.equal(Boolean(button('外部アプリ')), host === 'desktop');
    select('環境', 'spfx'); await settle();
    assert.equal(button('AI'), undefined);
    assert.equal(button('外部アプリ'), undefined);
    assert.match(document.querySelector('.profile-storage').textContent, /SharePoint/);
    select('環境', 'desktop'); await settle();
    assert.ok(button('AI'));
    button('コード').click(); await settle();
    assert.equal(document.querySelector('[aria-label="プレビュー領域"]'), null);
    button('ビジュアル').click(); await settle();
    assert.equal(document.querySelector('[aria-label="コード領域"]'), null);
    button('コード｜ビジュアル').click(); await settle();
    assert.ok(document.querySelector('[aria-label="コード領域"]'));
    assert.ok(document.querySelector('[aria-label="プレビュー領域"]'));
    select('テーマ', 'dark'); await settle();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    select('画面幅', '390'); await settle();
    assert.equal(document.querySelector('.prototype-frame').style.width, '390px');
    document.querySelector('input[type="checkbox"]').click(); await settle();
    assert.equal(button('保存').disabled, true);
    assert.equal(button('新規MD').disabled, true);
    document.querySelector('button[aria-label="目次パネル"]').click(); await settle();
    assert.ok(document.querySelector('[role="dialog"]'));
    document.querySelector('.document-side-panel__header button').click(); await settle();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    button('開く').click(); await settle();
    assert.match(document.querySelector('[role="status"]').textContent, /実処理は接続していません/);
    assert.deepEqual(failures, []);
    globalThis.console.log(`${host}: 初期環境・動的切替・表示モード・テーマ・幅・閲覧権限・サイドパネル・模擬操作 OK`);
  } finally { dom.window.close(); }
}
