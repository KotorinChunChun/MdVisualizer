export async function run({ evaluate, screenshot }) {
  const viewContext = await evaluate(`new Promise((resolve) => {
    const target = document.querySelector('.markdown-body p[data-source-line]');
    const previewButton = document.querySelector('[data-ui-command="view.visual"]');
    if (!target || !previewButton) { resolve({ ok: false, reason: '対象行またはビジュアルボタンがありません' }); return; }
    const line = Number(target.dataset.sourceLine);
    target.scrollIntoView({ block: 'center' });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 300 }));
    setTimeout(() => {
      const stayedPreview = previewButton.getAttribute('aria-pressed') === 'true' && !document.querySelector('.markdown-editor');
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
      setTimeout(() => {
        const labels = [...document.querySelectorAll('.preview-context-menu [role=menuitem]')].map((button) => button.textContent.trim());
        const lineSelect = [...document.querySelectorAll('.preview-context-menu [role=menuitem]')].find((button) => button.textContent.trim() === '行選択');
        lineSelect?.click();
        setTimeout(() => {
          const selectedText = window.getSelection()?.toString().trim() ?? '';
          target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
          setTimeout(() => {
            const edit = [...document.querySelectorAll('.preview-context-menu [role=menuitem]')].find((button) => button.textContent.trim() === '編集');
            edit?.click();
            const deadline = Date.now() + 5000;
            const poll = () => {
              const highlighted = document.querySelector('.is-editor-current-line');
              if (document.querySelector('.markdown-editor') && highlighted) {
                resolve({ ok: true, stayedPreview, labels, selectedText, requestedLine: line, highlightedLine: Number(highlighted.dataset.sourceLine) });
              } else if (Date.now() >= deadline) resolve({ ok: false, stayedPreview, labels, selectedText, requestedLine: line, reason: '編集切替または現在行強調が完了しませんでした' });
              else setTimeout(poll, 50);
            };
            poll();
          }, 50);
        }, 50);
      }, 50);
    }, 150);
  })`);
  const viewContextScreenshot = await screenshot("view-context-menu-edit.png");
  if (!viewContext.ok || !viewContext.stayedPreview || !viewContext.selectedText
    || JSON.stringify(viewContext.labels) !== JSON.stringify(['マークダウンでコピー', 'プレーンテキストでコピー', '編集', '下にブロックを追加', '行選択', 'ブロック全体を選択', 'すべて選択'])
    || viewContext.highlightedLine > viewContext.requestedLine) {
    throw new Error(`View context verification failed: ${JSON.stringify(viewContext)}`);
  }
  await evaluate(`new Promise((resolve) => {
    document.querySelector('[data-ui-command="view.browse"]')?.click();
    document.querySelector('[data-ui-command="view.visual"]')?.click();
    setTimeout(resolve, 150);
  })`);

  return { viewContext, viewContextScreenshot };
}
