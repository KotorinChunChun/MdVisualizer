export async function run({ evaluate }, documentName = 'v0.0.10-editing.md') {
  const result = await evaluate(`new Promise((resolve) => {
    const target = [...document.querySelectorAll('.tab[title]')].find(tab =>
      tab.title.replaceAll('\\\\', '/').split('/').pop() === ${JSON.stringify(documentName)});
    if (!target) { resolve({ ready: false, reason: '専用サンプルのタブがありません' }); return; }
    target.click();
    setTimeout(() => {
      document.querySelector('.media-preview__close')?.click();
      const diff = document.querySelector('[data-ui-command="document.diff"]');
      if (diff?.getAttribute('aria-pressed') === 'true') diff.click();
      const preview = document.querySelector('[data-ui-command="view.visual"]');
      if (!preview) { resolve({ ready: false, reason: 'ビジュアルボタンがありません' }); return; }
      document.querySelector('[data-ui-command="view.browse"]')?.click();
      preview.click();
      const deadline = Date.now() + 5000;
      const poll = () => {
        if (preview.getAttribute('aria-pressed') === 'true' && document.querySelector('.markdown-body')) resolve({ ready: true });
        else if (Date.now() >= deadline) resolve({ ready: false, reason: '専用文書が5秒以内に表示されませんでした' });
        else setTimeout(poll, 50);
      };
      poll();
    }, 100);
  })`);
  if (!result?.ready) throw new Error(result?.reason ?? '専用文書の準備に失敗しました。');
  return { documentReady: true };
}
