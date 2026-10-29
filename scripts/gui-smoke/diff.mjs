export async function run({ evaluate, screenshot }) {
  const diffPreview = await evaluate(`new Promise((resolve) => {
    const startedAt = performance.now();
    const button = document.querySelector('[data-ui-command="document.diff"]');
    if (!button) { resolve({ opened: false, reason: '差分ボタンがありません' }); return; }
    button.click();
    const deadline = Date.now() + 20000;
    const poll = () => {
      const workspace = document.querySelector('.document-diff-workspace');
      const panes = workspace?.querySelectorAll('.document-diff__pane').length ?? 0;
      const renderedPanes = workspace?.querySelectorAll('.document-diff__rendered').length ?? 0;
      if (workspace && panes > 0 && renderedPanes === panes) {
        resolve({
          opened: true,
          mode: workspace.querySelector('.document-diff__panes--three-way') ? 'three-way' : 'two-way',
          panes,
          renderedPanes,
          summary: workspace.querySelector('.document-diff-workspace__header small')?.textContent ?? '',
          interactiveDiagrams: workspace.querySelectorAll('.mermaid-container, .drawio-block').length,
          durationMs: performance.now() - startedAt,
        });
      } else if (Date.now() >= deadline) resolve({ opened: false, reason: '20秒以内に開きませんでした' });
      else setTimeout(poll, 100);
    };
    poll();
  })`);
  const diffRenderedScreenshot = await screenshot("diff-rendered.png");

  const diffCode = await evaluate(`new Promise((resolve) => {
    const startedAt = performance.now();
    const button = document.querySelector('[data-ui-command="view.code"]');
    button?.click();
    const deadline = Date.now() + 5000;
    const poll = () => {
      const workspace = document.querySelector('.document-diff-workspace');
      const panes = workspace?.querySelectorAll('.document-diff__pane').length ?? 0;
      const codePanes = workspace?.querySelectorAll('.document-diff__code, .document-diff__pane > .markdown-editor').length ?? 0;
      if ((panes > 0 && codePanes === panes) || Date.now() >= deadline) {
        resolve({
          panes,
          codePanes,
          highlightedBlocks: document.querySelectorAll('.markdown-diff-line').length,
          durationMs: performance.now() - startedAt,
        });
      } else setTimeout(poll, 50);
    };
    poll();
  })`);
  const diffCodeScreenshot = await screenshot("diff-code.png");

  const diffSplit = await evaluate(`new Promise((resolve) => {
    const startedAt = performance.now();
    const button = document.querySelector('[data-ui-command="view.split"]');
    button?.click();
    const deadline = Date.now() + 5000;
    const poll = () => {
      const workspace = document.querySelector('.document-diff-workspace');
      const panes = workspace?.querySelectorAll('.document-diff__pane').length ?? 0;
      const codePanes = workspace?.querySelectorAll('.document-diff__code, .document-diff__pane > .markdown-editor').length ?? 0;
      const renderedPanes = workspace?.querySelectorAll('.document-diff__rendered').length ?? 0;
      if ((panes === 4 && codePanes === 2 && renderedPanes === 2) || Date.now() >= deadline) {
        resolve({ panes, codePanes, renderedPanes, interactiveDiagrams: workspace?.querySelectorAll('.mermaid-container, .drawio-block').length ?? 0, durationMs: performance.now() - startedAt });
      } else setTimeout(poll, 50);
    };
    poll();
  })`);
  const diffSplitScreenshot = await screenshot("diff-split.png");
  const diffScroll = await evaluate(`new Promise((resolve) => {
    const scrollers = [...document.querySelectorAll('.document-diff__code, .document-diff__rendered, .document-diff-workspace .cm-scroller')];
    const source = scrollers.find((element) => element.scrollHeight - element.clientHeight > 20);
    if (!source) { resolve({ synced: false, reason: 'スクロール可能なDIFFペインがありません' }); return; }
    const maximum = source.scrollHeight - source.clientHeight;
    source.scrollTop = maximum * 0.6;
    source.dispatchEvent(new Event('scroll'));
    setTimeout(() => {
      const ratios = scrollers.filter((element) => element.scrollHeight - element.clientHeight > 20).map((element) => ({
        className: element.className,
        ratio: element.scrollTop / (element.scrollHeight - element.clientHeight),
      }));
      resolve({ synced: ratios.length >= 2 && ratios.every((item) => Math.abs(item.ratio - 0.6) < 0.08), ratios });
    }, 100);
  })`);

  const diffClosed = await evaluate(`new Promise((resolve) => {
    const previewButton = document.querySelector('[data-ui-command="view.visual"]');
    previewButton?.click();
    const button = document.querySelector('[data-ui-command="document.diff"]');
    button?.click();
    const deadline = Date.now() + 2000;
    const poll = () => {
      if (!document.querySelector('.document-diff-workspace') && button?.getAttribute('aria-pressed') === 'false') resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 25);
    };
    poll();
  })`);

  if (!diffPreview.opened || ![2, 3].includes(diffPreview.panes) || diffPreview.interactiveDiagrams !== 0 || diffPreview.durationMs > 5000
    || diffCode.codePanes !== diffCode.panes || diffCode.durationMs > 5000
    || diffSplit.panes !== 4 || diffSplit.codePanes !== 2 || diffSplit.renderedPanes !== 2 || diffSplit.interactiveDiagrams !== 0 || diffSplit.durationMs > 5000
    || !diffScroll.synced
    || !diffClosed) {
    throw new Error(`Document diff verification failed: ${JSON.stringify({ diffPreview, diffCode, diffSplit, diffScroll, diffClosed })}`);
  }
  return { diffPreview, diffCode, diffSplit, diffScroll, diffClosed, diffRenderedScreenshot, diffCodeScreenshot, diffSplitScreenshot };
}
