export async function run({ evaluate, screenshot }) {
  await evaluate(`document.querySelector('.mermaid-container')?.scrollIntoView({ block: 'center', inline: 'center' })`);
  const mermaidReady = await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 20000;
    const poll = () => {
      if (document.querySelector('.mermaid-block svg')) resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 100);
    };
    poll();
  })`);
  if (!mermaidReady) throw new Error("Mermaid preview did not render within 20 seconds");

  const initialScreenshot = await screenshot("initial-window.png");
  const mermaid = await evaluate(`new Promise((resolve) => {
    const block = document.querySelector('.mermaid-block');
    block.scrollIntoView({ block: 'center', inline: 'center' });
    block.click();
    setTimeout(() => {
      const modal = document.querySelector('.media-preview');
      const viewport = modal?.querySelector('.media-preview__viewport');
      const stage = modal?.querySelector('.media-preview__stage');
      const transform = modal?.querySelector('.media-preview__transform');
      const canvas = modal?.querySelector('.media-preview__svg');
      const rect = transform?.getBoundingClientRect();
      const fillsWidth = !!rect && Math.abs(rect.width - viewport.clientWidth) <= 3;
      const fillsHeight = !!rect && Math.abs(rect.height - viewport.clientHeight) <= 3;
      resolve({
        opened: !!modal,
        canvasBackground: canvas ? getComputedStyle(canvas).backgroundColor : null,
        viewport: viewport ? { width: viewport.clientWidth, height: viewport.clientHeight } : null,
        media: rect ? { width: rect.width, height: rect.height } : null,
        fillsWidth,
        fillsHeight,
        maximumFit: fillsWidth || fillsHeight,
        stage: stage ? { width: stage.scrollWidth, height: stage.scrollHeight } : null,
        extraScrollableCanvas: !!stage && (stage.scrollWidth > viewport.clientWidth + 3 || stage.scrollHeight > viewport.clientHeight + 3),
        inlineBackground: getComputedStyle(block).backgroundColor,
      });
    }, 300);
  })`);
  const mermaidScreenshot = await screenshot("mermaid-popup.png");
  await evaluate(`document.querySelector('.media-preview__close')?.click()`);

  if (!mermaid.opened || !mermaid.maximumFit || mermaid.extraScrollableCanvas) {
    throw new Error(`Mermaid maximum-fit verification failed: ${JSON.stringify(mermaid)}`);
  }
  if (mermaid.canvasBackground !== "rgb(255, 255, 255)" || mermaid.inlineBackground !== "rgb(255, 255, 255)") {
    throw new Error(`Mermaid white canvas verification failed: ${JSON.stringify(mermaid)}`);
  }
  return { mermaid, initialScreenshot, mermaidScreenshot };
}
