import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn(), readDocumentAsset: vi.fn(), exportHtmlInBrowser: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../lib/commands', () => ({ readDocumentAsset: mocks.readDocumentAsset }));
vi.mock('../lib/htmlExport', () => ({ exportHtmlInBrowser: mocks.exportHtmlInBrowser }));
import { DesktopHtmlExport, type DesktopExportSnapshot } from './DesktopHtmlExport';

const snapshot = (): DesktopExportSnapshot => ({
  document: { path: 'spmd://tenant/drive/folder/note.md', kind: 'markdown', content: '原本', base_dir: 'spmd://tenant/drive/folder', image_paths: [], encoding: 'utf-8', size_bytes: 1, modified_at: '', revision: 'r1', source: 'sharepoint' },
  content: '![下書き](draft.png)\n\n![外部図](nested/diagram.mmd)', theme: 'dark', css: '',
  assets: [{ id: 'draft', filename: 'draft.png', mediaType: 'image/png', base64: 'AA==' }, { id: 'diagram', filename: 'nested/diagram.mmd', mediaType: 'text/plain', text: '![子画像](child.png)' }],
});

describe('DesktopHtmlExport', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('fixes the unsaved snapshot, staged assets, nested paths, and SharePoint asset reads before saving', async () => {
    const value = snapshot(); const getSnapshot = vi.fn(() => value);
    mocks.save.mockResolvedValue('C:/out/note.html');
    mocks.readDocumentAsset.mockResolvedValue({ mediaType: 'image/png', base64: 'AQ==', source: 'sharepoint' });
    mocks.exportHtmlInBrowser.mockImplementation(async (options) => {
      expect(options.markdown).toContain('下書き');
      const draft = await options.readAsset('draft.png', options.baseDir);
      expect(draft.data).toBe('data:image/png;base64,AA==');
      const diagram = await options.readAsset('nested/diagram.mmd', options.baseDir);
      expect(diagram.text).toBe('![子画像](child.png)');
      const nested = await options.readAsset('child.png', diagram.base);
      expect(nested.data).toBe('data:image/png;base64,AQ==');
      expect(mocks.readDocumentAsset).toHaveBeenCalledWith(value.document.path, 'nested/child.png');
      return { html: '<!doctype html><title>snapshot</title>', mode: 'static', bytes: 1, items: 3, diagrams: 0, tables: 0, rasterized: 0 };
    });
    render(<DesktopHtmlExport disabled={false} getSnapshot={getSnapshot} />);
    fireEvent.click(screen.getByRole('button', { name: 'HTML出力' }));
    value.content = '# 切替後'; value.theme = 'light'; value.assets[0].base64 = 'changed';
    fireEvent.click(screen.getByRole('button', { name: 'HTMLを出力' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('save_html_export', expect.objectContaining({ path: 'C:/out/note.html', documentPath: 'spmd://tenant/drive/folder/note.md', html: '<!doctype html><title>snapshot</title>' })));
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it('does not render or save when the native dialog is cancelled, and does not save after an export error', async () => {
    mocks.save.mockResolvedValueOnce(null);
    render(<DesktopHtmlExport disabled={false} getSnapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: 'HTML出力' })); fireEvent.click(screen.getByRole('button', { name: 'HTMLを出力' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.exportHtmlInBrowser).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.save.mockResolvedValueOnce('C:/out/fail.html'); mocks.exportHtmlInBrowser.mockRejectedValueOnce(new Error('資産がありません。'));
    fireEvent.click(screen.getByRole('button', { name: 'HTML出力' })); fireEvent.click(screen.getByRole('button', { name: 'HTMLを出力' }));
    await waitFor(() => expect(mocks.exportHtmlInBrowser).toHaveBeenCalledOnce());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
