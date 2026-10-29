export async function run({ evaluate, screenshot }) {
  await evaluate(`document.querySelector('.drawio-block')?.scrollIntoView({ block: 'center', inline: 'center' })`);
  const drawioReady = await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 20000;
    const poll = () => {
      const zoom = document.querySelector('.drawio-block__zoom');
      if (zoom) resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 100);
    };
    poll();
  })`);
  if (!drawioReady) throw new Error("Cropped draw.io SVG did not appear within 20 seconds");
  const drawio = await evaluate(`new Promise((resolve) => {
    const zoom = document.querySelector('.drawio-block__zoom');
    const inlineSvg = zoom.querySelector('svg');
    const viewBox = inlineSvg.viewBox.baseVal;
    const bounds = (inlineSvg.querySelector(':scope > g') ?? inlineSvg).getBBox();
    const margins = {
      left: bounds.x - viewBox.x,
      top: bounds.y - viewBox.y,
      right: viewBox.x + viewBox.width - bounds.x - bounds.width,
      bottom: viewBox.y + viewBox.height - bounds.y - bounds.height,
    };
    zoom.scrollIntoView({ block: 'center', inline: 'center' });
    zoom.click();
    setTimeout(() => {
      const modal = document.querySelector('.media-preview');
      const viewport = modal?.querySelector('.media-preview__viewport');
      const transform = modal?.querySelector('.media-preview__transform');
      const rect = transform?.getBoundingClientRect();
      const fillsWidth = !!rect && Math.abs(rect.width - viewport.clientWidth) <= 3;
      const fillsHeight = !!rect && Math.abs(rect.height - viewport.clientHeight) <= 3;
      resolve({
        opened: !!modal,
        margins,
        extraRightBottomWhitespace: margins.right > 32 || margins.bottom > 32,
        maximumFit: fillsWidth || fillsHeight,
        viewport: viewport ? { width: viewport.clientWidth, height: viewport.clientHeight } : null,
        media: rect ? { width: rect.width, height: rect.height } : null,
      });
    }, 300);
  })`);
  const drawioScreenshot = await screenshot("drawio-popup.png");
  await evaluate(`document.querySelector('.media-preview__close')?.click()`);

  if (!drawio.opened || !drawio.maximumFit || drawio.extraRightBottomWhitespace) {
    throw new Error(`draw.io popup verification failed: ${JSON.stringify(drawio)}`);
  }
  return { drawio, drawioScreenshot };
}
