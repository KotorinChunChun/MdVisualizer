import { describe, expect, it, vi } from 'vitest';
import { printWebDocument } from './printDocument';

const exported = { html: '<!doctype html><img src="data:image/png;base64,AA==">', mode: 'static' as const, bytes: 64, items: 1, diagrams: 0, tables: 0, rasterized: 0 };

function fixture(event: 'load' | 'error' = 'load') {
  const events = new EventTarget();
  const remove = vi.fn();
  const print = vi.fn(() => events.dispatchEvent(new Event('afterprint')));
  const frame = Object.assign(events, {
    title: '', srcdoc: '', style: { cssText: '' }, remove,
    setAttribute: vi.fn(),
    contentWindow: Object.assign(events, { print }),
    contentDocument: { fonts: { ready: Promise.resolve() }, images: [] },
  });
  const host = {
    body: { append: vi.fn(() => queueMicrotask(() => events.dispatchEvent(new Event(event)))) },
    createElement: vi.fn(() => frame),
  };
  return { host: host as unknown as Document, remove, print, frame };
}

const options = (host: Document, exportHtml = vi.fn(async () => exported)) => ({
  markdown: '# 全文', title: '文書', theme: 'light', baseDir: '', readAsset: vi.fn(),
  runtime: { document: host, exportHtml },
});

describe('printWebDocument', () => {
  it('prints a static full-document export in a ready offscreen iframe and cleans it up', async () => {
    const { host, remove, print, frame } = fixture(); const exportHtml = vi.fn(async () => exported);
    await expect(printWebDocument(options(host, exportHtml))).resolves.toEqual(exported);
    expect(exportHtml).toHaveBeenCalledWith(expect.objectContaining({ mode: 'static', markdown: '# 全文' }));
    expect(frame.srcdoc).toBe(exported.html); expect(frame.setAttribute).toHaveBeenCalledWith('sandbox', 'allow-same-origin allow-modals');
    expect(print).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalled();
  });

  it('cleans up an iframe when its static snapshot fails to load', async () => {
    const { host, remove } = fixture('error');
    await expect(printWebDocument(options(host))).rejects.toThrow('印刷用文書を読み込めません');
    expect(remove).toHaveBeenCalled();
  });
});
