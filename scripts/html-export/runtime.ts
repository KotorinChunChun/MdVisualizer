// 出力HTML内で完結する操作。文書の文字列をJavaScriptへ連結しない。
export const outputControlsScript = String.raw`(() => {
  document.documentElement.classList.add('export-interactive');
  const main = document.querySelector('main.markdown-body');
  const toast = document.createElement('div'); toast.className = 'export-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.hidden = true; document.body.append(toast);
  let toastTimer;
  function notify(message) { clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false; toastTimer = setTimeout(() => { toast.hidden = true; toast.textContent = ''; }, 3000); }
  function button(action, label) { const el = document.createElement('button'); el.type = 'button'; el.className = 'export-action'; el.dataset.exportAction = action; el.textContent = label; return el; }
  const folds = [];
  for (const heading of Array.from(main.querySelectorAll('h2,h3,h4,h5,h6')).reverse()) {
    const level = Number(heading.tagName[1]); const body = document.createElement('div'); body.className = 'export-fold-body';
    let sibling = heading.nextSibling;
    while (sibling) {
      if (sibling.nodeType === 1 && /^H[1-6]$/.test(sibling.tagName) && Number(sibling.tagName[1]) <= level) break;
      const next = sibling.nextSibling; body.append(sibling); sibling = next;
    }
    heading.after(body);
    const label = heading.textContent; const toggle = button('fold', '▾'); toggle.setAttribute('aria-label', label + 'を折りたたむ'); toggle.setAttribute('aria-expanded', 'true');
    heading.prepend(toggle); folds.push({ heading, body, toggle, label });
  }
  function setFold(fold, closed) { fold.body.hidden = closed; fold.toggle.textContent = closed ? '▸' : '▾'; fold.toggle.setAttribute('aria-expanded', String(!closed)); fold.toggle.setAttribute('aria-label', fold.label + (closed ? 'を展開する' : 'を折りたたむ')); }
  function revealHash() {
    let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id); if (!target) return;
    for (const fold of folds) if (fold.body.contains(target) || fold.heading === target) setFold(fold, false);
    target.scrollIntoView();
  }
  const toc = main.querySelector('.export-toc');
  if (toc && folds.length) { const actions = document.createElement('div'); actions.className = 'export-actions'; actions.append(button('expand-all', 'すべて展開'), button('collapse-all', 'すべて折りたたむ')); toc.querySelector('nav').prepend(actions); }
  window.addEventListener('hashchange', revealHash); if (location.hash) revealHash();
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
  for (const block of main.querySelectorAll('.export-table-block')) {
    const table = block.querySelector('table'); const rows = Array.from(table.querySelectorAll('tbody > tr'));
    const state = { rows, column: -1, direction: 0 };
    const search = document.createElement('input'); search.type = 'search'; search.className = 'export-table-filter'; search.placeholder = '表を絞り込み（全列）'; search.setAttribute('aria-label', '表を絞り込み（全列）');
    const count = document.createElement('span'); count.className = 'export-table-count'; count.setAttribute('role', 'status');
    const toolbar = block.querySelector('.export-actions'); toolbar.prepend(search, count);
    const regular = rows.filter(row => !row.hasAttribute('data-export-total'));
    const totals = rows.length !== regular.length;
    function filter() {
      const query = search.value.toLocaleLowerCase(); let shown = 0;
      for (const row of rows) {
        if (row.hasAttribute('data-export-total')) { row.hidden = false; continue; }
        row.hidden = !Array.from(row.cells).some(cell => (cell.textContent || '').toLocaleLowerCase().includes(query));
        if (!row.hidden) shown++;
      }
      count.textContent = shown + ' / ' + regular.length + '行' + (totals ? '（集計は全行）' : '');
    }
    search.addEventListener('input', filter); filter();
    const headers = Array.from(table.querySelectorAll('thead th'));
    headers.forEach((header, column) => {
      const title = header.textContent || '列' + (column + 1); const sort = button('sort', '↕'); sort.setAttribute('aria-label', title + 'で並べ替え'); header.append(sort); header.setAttribute('aria-sort', 'none');
      sort.addEventListener('click', () => {
        state.direction = state.column === column ? (state.direction + 1) % 3 : 1; state.column = column;
        headers.forEach((h, index) => { h.setAttribute('aria-sort', index === column ? ['none', 'ascending', 'descending'][state.direction] : 'none'); h.querySelector('button').textContent = index === column ? ['↕', '↑', '↓'][state.direction] : '↕'; });
        const ordered = [...regular];
        const value = row => (row.cells[column]?.textContent || '').trim();
        const number = text => text && /^[+-]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text.replaceAll(',', '')) : NaN;
        if (state.direction) ordered.sort((a, b) => { const av = value(a), bv = value(b), an = number(av), bn = number(bv); const compare = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : collator.compare(av, bv); return (state.direction === 1 ? compare : -compare) || rows.indexOf(a) - rows.indexOf(b); });
        if (!state.direction) { for (const row of rows) row.parentElement.append(row); }
        else { for (const row of [...ordered, ...rows.filter(row => row.hasAttribute('data-export-total'))]) row.parentElement.append(row); }
      });
    });
  }
  let dialog, zoomImage, zoomSource, zoomScale = 1, fitWidth = 1, oldOverflow;
  function closeZoom() { if (dialog?.open) dialog.close(); }
  function resizeZoom() { zoomImage.style.width = Math.max(1, fitWidth * zoomScale) + 'px'; dialog.querySelector('.export-zoom-size').textContent = Math.round(zoomScale * 100) + '%'; }
  function openZoom(source) {
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'export-zoom'; dialog.setAttribute('aria-label', '図・画像の拡大表示'); dialog.style.backgroundColor = document.body.style.backgroundColor; dialog.style.color = document.body.style.color;
      const toolbar = document.createElement('div'); toolbar.className = 'export-actions';
      const size = document.createElement('span'); size.className = 'export-zoom-size'; size.setAttribute('aria-live', 'polite');
      toolbar.append(button('zoom-out', '縮小'), button('zoom-in', '拡大'), button('zoom-reset', '画面に合わせる'), size, button('zoom-close', '閉じる'));
      const viewport = document.createElement('div'); viewport.className = 'export-zoom-viewport'; zoomImage = new Image(); viewport.append(zoomImage); dialog.append(toolbar, viewport); document.body.append(dialog);
      dialog.addEventListener('click', event => { if (event.target === dialog) closeZoom(); });
      dialog.addEventListener('close', () => { document.body.style.overflow = oldOverflow; zoomSource?.focus({preventScroll:true}); });
    }
    zoomSource = source; zoomImage.src = source.src; zoomImage.alt = source.alt;
    fitWidth = Math.min(source.naturalWidth, innerWidth * .9 - 48); zoomScale = 1; resizeZoom();
    oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.showModal();
  }
  for (const image of main.querySelectorAll('img')) {
    image.classList.add('export-zoomable'); image.tabIndex = 0; image.setAttribute('role', 'button'); image.setAttribute('aria-label', (image.alt || '図・画像') + 'を拡大');
    image.addEventListener('click', () => openZoom(image));
    image.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openZoom(image); } });
  }
  window.addEventListener('resize', () => { if (dialog?.open) { fitWidth = Math.min(zoomSource.naturalWidth, innerWidth * .9 - 48); resizeZoom(); } });
  document.addEventListener('click', async event => {
    const tocLink = event.target.closest && event.target.closest('.export-toc a');
    if (tocLink) { tocLink.closest('details').open = false; for (const fold of folds) { const target = document.getElementById(decodeURIComponent(tocLink.hash.slice(1))); if (target && (fold.body.contains(target) || fold.heading === target)) setFold(fold, false); } }
    const button = event.target.closest && event.target.closest('button[data-export-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.exportAction;
    if (action === 'fold') { const fold = folds.find(item => item.toggle === button); setFold(fold, !fold.body.hidden); return; }
    if (action === 'expand-all' || action === 'collapse-all') { folds.forEach(fold => setFold(fold, action === 'collapse-all')); return; }
    if (action.startsWith('zoom-')) { if (action === 'zoom-close') closeZoom(); else { zoomScale = action === 'zoom-reset' ? 1 : Math.max(.5, Math.min(4, zoomScale + (action === 'zoom-in' ? .25 : -.25))); resizeZoom(); } return; }
    const block = button.closest('.export-code-block,.export-table-block'); if (!block) return;
    if (action === 'sort') return;
    if (action === 'wrap') { const enabled = block.classList.toggle('export-wrap'); button.setAttribute('aria-pressed', String(enabled)); return; }
    const code = block.querySelector('pre code') || block.querySelector('pre');
    const text = code ? code.textContent : Array.from(block.querySelectorAll('table tr')).filter(row => !row.hidden).map(row => Array.from(row.cells, cell => {
      const clone = cell.cloneNode(true); clone.querySelectorAll('button').forEach(el => el.remove());
      clone.querySelectorAll('br').forEach(el => el.replaceWith(document.createTextNode('\n')));
      const value = clone.textContent || '';
      return /[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    }).join('\t')).join('\n');
    button.disabled = true; let copied = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch {}
    if (!copied) {
      const focus = document.activeElement, selection = window.getSelection();
      const ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
      const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(area); area.select();
      try { copied = document.execCommand('copy'); } catch {} finally { area.remove(); if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); } if (focus && focus.focus) focus.focus({preventScroll:true}); }
    }
    notify(copied ? 'コピーしました' : 'コピーできません。本文を選択してコピーしてください'); button.disabled = false;
  });
})();`;
