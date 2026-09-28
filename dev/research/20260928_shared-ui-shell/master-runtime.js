(() => {
  const source = document.getElementById('ui-master');
  const mount = document.getElementById('generated-ui');
  const platform = document.getElementById('platform');
  const readonly = document.getElementById('readonly');
  const php = document.getElementById('php');
  const allControls = JSON.parse(document.getElementById('inventory-data').textContent);
  let format = 'mermaid';
  let mode = 'split';
  const notify = text => { document.getElementById('notice').textContent = text; };
  const matches = (tokens, token) => tokens.split(/\s+/).includes(token);
  // React版では同じ判定を描画前に行う。ここでは未接続のtemplate断片を絞り込む。
  function filter(fragment) {
    for (const element of [...fragment.querySelectorAll('[data-platforms],[data-capability],[data-formats]')]) {
      if ((platform.value !== 'all' && element.dataset.platforms && !matches(element.dataset.platforms, platform.value)) ||
          (platform.value !== 'all' && element.dataset.capability === 'php' && !php.checked) ||
          (element.dataset.formats && !matches(element.dataset.formats, format))) element.remove();
    }
    for (const element of fragment.querySelectorAll('[data-write]')) element.disabled = readonly.checked;
    for (const group of [...fragment.querySelectorAll('[data-group],.master-segment,.block-controls details')].reverse()) {
      if (!group.querySelector('button,input,select,textarea')) group.remove();
    }
  }
  function render() {
    const openSections = [...mount.querySelectorAll('details[open][data-group]')].map(node => node.dataset.group);
    const fragment = source.content.cloneNode(true);
    filter(fragment);
    mount.replaceChildren(fragment);
    mount.classList.toggle('show-platforms', platform.value === 'all');
    mount.querySelector('#block-format').value = format;
    const themeControl = mount.querySelector('[data-action="theme"]');
    if (themeControl) themeControl.value = document.documentElement.dataset.theme;
    for (const section of mount.querySelectorAll('details[data-group]')) if (openSections.includes(section.dataset.group)) section.open = true;
    applyMode();
    document.getElementById('visible-count').textContent = `${mount.querySelectorAll('[data-action]').length} 操作を表示`;
    renderInventory();
  }
  function applyMode() {
    mount.querySelector('.master-code').hidden = mode === 'visual';
    mount.querySelector('.master-preview').hidden = mode === 'code';
    for (const button of mount.querySelectorAll('[data-action^="view."]')) if (button.tagName === 'BUTTON') {
      const active = button.dataset.action === `view.${mode}`;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
  }
  const dialog = document.getElementById('sample-dialog');
  const dialogBody = document.getElementById('dialog-body');
  let returnFocus = null;
  function showDialog(action, title, trigger) {
    returnFocus = trigger;
    document.getElementById('dialog-title').textContent = title;
    dialogBody.replaceChildren();
    const description = document.createElement('p'); description.textContent = '配置を確認するための見本です。編集・保存・認証・外部アプリは接続していません。'; dialogBody.append(description);
    if (/table/.test(action)) {
      const table = document.createElement('table');
      for (const row of [['項目', '状態'], ['要件整理', '完了'], ['UI統合', '確認中']]) { const tr = table.insertRow(); for (const value of row) tr.insertCell().textContent = value; }
      dialogBody.append(table);
    } else if (/image/.test(action)) {
      const preview = document.createElement('div'); preview.className = 'image-placeholder'; preview.textContent = '画像プレビュー'; dialogBody.append(preview);
    } else if (/mermaid|drawio|svg|diff|ai/.test(action)) {
      const area = document.createElement('textarea'); area.readOnly = true; area.setAttribute('aria-label', 'ダイアログのサンプル'); area.value = action.includes('diff') ? '変更前                         変更後\n要件整理                       要件整理・UI統合' : '図・コード・会話の編集領域（固定サンプル）'; dialogBody.append(area);
    } else {
      const label = document.createElement('label'); label.textContent = action.includes('export') ? '出力形式 ' : '表示設定 ';
      const select = document.createElement('select'); for (const text of action.includes('export') ? ['静的HTML', '対話型HTML'] : ['既定', 'カスタム']) select.add(new Option(text)); label.append(select); dialogBody.append(label);
    }
    dialog.showModal();
  }
  document.getElementById('close-dialog').onclick = () => dialog.close();
  dialog.addEventListener('close', () => returnFocus?.focus());
  mount.addEventListener('click', event => {
    const control = event.target.closest('button[data-action]'); if (!control || control.disabled) return;
    const action = control.dataset.action;
    if (['view.code', 'view.split', 'view.visual'].includes(action)) { mode = action.slice(5); applyMode(); return; }
    if (action.startsWith('mode.')) { for (const button of mount.querySelectorAll('[data-action^="mode."]')) { const active = button === control; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); } return; }
    if (action.startsWith('dialog.') || ['document.diff','document.export-html','settings','desktop.ai','block.edit','spfx.settings'].includes(action)) { showDialog(action === 'block.edit' ? `dialog.${format}` : action, control.textContent, control); return; }
    notify(`${control.textContent}：外見の試作です。実処理は実行していません。`);
  });
  mount.addEventListener('change', event => {
    const control = event.target;
    if (control.id === 'block-format') { format = control.value; render(); return; }
    if (control.dataset.action === 'theme') document.documentElement.dataset.theme = control.value;
    if (control.dataset.action === 'zoom') mount.querySelector('.markdown-body').style.fontSize = `${control.value}%`;
    if (control.dataset.action === 'view.direction') mount.querySelector('.master-panes').dataset.direction = control.value;
  });
  function renderInventory() {
    const query = document.getElementById('inventory-search').value.toLowerCase();
    const rows = allControls.filter(row => `${row.displayName} ${row.source.file} ${row.controlKind}`.toLowerCase().includes(query));
    document.getElementById('inventory-count').textContent = `${rows.length} / ${allControls.length} 件`;
    const body = document.getElementById('inventory-rows'); body.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [row.displayName || '動的名称（要確認）', row.controlKind, row.source.kind, `${row.source.file}:${row.source.line}`]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      body.append(tr);
    }
  }
  document.getElementById('inventory-search').addEventListener('input', renderInventory);
  platform.value = document.body.dataset.initialHost || 'all';
  platform.onchange = render; readonly.onchange = render; php.onchange = render;
  document.getElementById('width').onchange = event => { document.getElementById('preview-width').style.maxWidth = event.target.value === 'full' ? 'none' : `${event.target.value}px`; };
  render();
})();
