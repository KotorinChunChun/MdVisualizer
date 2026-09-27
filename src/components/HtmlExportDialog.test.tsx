import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HtmlExportDialog } from './HtmlExportDialog';

describe('HtmlExportDialog', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('uses static by default and passes the selected filename and mode', () => {
    const onExport = vi.fn();
    render(<HtmlExportDialog defaultFilename="report" onCancel={vi.fn()} onExport={onExport} />);
    expect(screen.getByRole('radio', { name: 'スクリプトなし' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'スクリプトあり' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'ファイル名' }), { target: { value: '  report.html  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'HTMLを出力' }));
    expect(onExport).toHaveBeenCalledWith({ mode: 'interactive', filename: 'report.html' });
  });

  it('shows progress, disables a duplicate export, and allows cancellation', () => {
    const onCancel = vi.fn();
    render(<HtmlExportDialog running progress="図を画像化しています (1/2)" onCancel={onCancel} onExport={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('図を画像化しています (1/2)');
    expect(screen.getByRole('button', { name: 'HTMLを出力' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '中止' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '中止' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '中止' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
