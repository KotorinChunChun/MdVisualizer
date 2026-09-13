// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importDocument, sessionZip, type DocumentSession } from './documentSession';
import { RemoteStorage } from './RemoteStorage';

vi.mock('./documentSession', async () => {
  const actual = await vi.importActual<typeof import('./documentSession')>('./documentSession');
  return {
    ...actual,
    importDocument: vi.fn(),
    sessionZip: vi.fn(async () => {
      const base64 = 'UEsDBBQACAgIAAMVLl0AAAAAAAAAAAAAAAAQAAkA6LOH5paZL+acrOaWhy5tZFVUBQAB9d+malNWeDZr+tP+7U97pj3ZP/f5uoW8XLxcitHPp+x+2twfq6Gnpw9h6j+dvVmvIC9dk5cLAFBLBwgIRjKyMwAAADMAAABQSwMEFAAICAgAAxUuXQAAAAAAAAAAAAAAAA4ACQDnlLvlg48v5ZuzLnBuZ1VUBQAB9d+makvLrCgpLUrVzcxNTE8FAFBLBwhTFTiaDwAAAA0AAABQSwECAAMUAAgICAADFS5dCEYysjMAAAAzAAAAEAAJAAAAAAAAAAAApIEAAAAA6LOH5paZL+acrOaWhy5tZFVUBQAB9d+malBLAQIAAxQACAgIAAMVLl1TFTiaDwAAAA0AAAAOAAkAAAAAAAAAAACkgXoAAADnlLvlg48v5ZuzLnBuZ1VUBQAB9d+malBLBQYAAAAAAgACAIwAAADOAAAAAAA=';
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      return new Blob([bytes], { type: 'application/zip' });
    }),
  };
});

const session: DocumentSession = {
  name: '資料/本文.md',
  markdown: '# 暗号化保管\r\n\r\n![画像](../画像/図.png)\r\n',
  encoding: 'Shift_JIS',
  bom: false,
  assets: [{ path: '画像/図.png', blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff])], { type: 'image/png' }) }],
};
const restoredSession: DocumentSession = {
  name: '資料/本文.md',
  markdown: session.markdown,
  encoding: 'UTF-8',
  bom: false,
  assets: [{ path: '画像/図.png', blob: new Blob([new TextEncoder().encode('fixture-image')], { type: 'image/png' }) }],
};

describe('RemoteStorageの暗号化クライアントフロー', () => {
  const password = 'client-flow-password';
  let uploaded: Blob | undefined;
  let corruptDownload = false;
  let fetchMock: ReturnType<typeof vi.fn>;
  let promptMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    uploaded = undefined;
    corruptDownload = false;
    promptMock = vi.fn().mockReturnValue(password);
    vi.stubGlobal('prompt', promptMock);
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('action=session')) return new Response(JSON.stringify({ user: { name: 'Test User', provider: 'google' }, csrf: 'csrf-token', providers: [], storageAvailable: true }), { status: 200 });
      if (url.includes('action=list')) return new Response(JSON.stringify({ items: uploaded ? [{ id: 'item-1', name: session.name, expires: 2000000000, bytes: uploaded.size }] : [] }), { status: 200 });
      if (url.includes('action=store')) {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-token');
        const body = init?.body as BodyInit | null | undefined;
        const bytes = body && typeof (body as { arrayBuffer?: unknown }).arrayBuffer === 'function'
          ? new Uint8Array(await (body as Blob).arrayBuffer())
          : body ? new Uint8Array(await new Response(body).arrayBuffer()) : undefined;
        uploaded = bytes ? new Blob([bytes], { type: 'application/zip' }) : undefined;
        return new Response(JSON.stringify({ item: { id: 'item-1', name: session.name, expires: 2000000000, bytes: uploaded?.size ?? 0 } }), { status: 201 });
      }
      if (url.includes('action=download')) {
        if (corruptDownload) return new Response('invalid archive', { status: 200 });
        const bytes = uploaded ? new Uint8Array(await uploaded.arrayBuffer()) : new Uint8Array();
        return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/zip' } });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(importDocument).mockResolvedValue(restoredSession);
    vi.mocked(sessionZip).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('暗号化ZIPをPOSTし、一覧から取得して文書と画像を復元する', async () => {
    const onOpen = vi.fn();
    const notify = vi.fn();
    render(React.createElement(RemoteStorage, { getSession: () => session, onOpen, notify }));
    await waitFor(() => expect(screen.getByText('Test User')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '現在の文書と画像を一時保管' }));
    await waitFor(() => expect(uploaded).toBeInstanceOf(Blob));
    expect(uploaded).toBeDefined();
    expect(new Uint8Array(await uploaded!.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    const posted = await importDocument(new Blob([await uploaded!.arrayBuffer()]), password);
    expect(posted.markdown).toBe(session.markdown);
    expect(posted.encoding).toBe('UTF-8');
    expect(Array.from(new Uint8Array(await posted.assets[0].blob.arrayBuffer()))).toEqual(Array.from(new TextEncoder().encode('fixture-image')));
    expect(vi.mocked(sessionZip)).toHaveBeenCalledWith(session, password);

    await waitFor(() => expect(screen.getByRole('button', { name: '復号して開く' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '復号して開く' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen.mock.calls[0][0].markdown).toBe(session.markdown);
    expect(notify).toHaveBeenCalledWith('文書と画像を暗号化して10日間一時保管しました。');
    expect(notify).toHaveBeenCalledWith('文書と画像を復元しました。');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('action=store'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('action=download'))).toBe(true);
    expect(vi.mocked(importDocument)).toHaveBeenCalledWith(expect.any(Blob), password);
  });

  it('復号に失敗した場合は開いた文書を置き換えず通知する', async () => {
    const onOpen = vi.fn();
    const notify = vi.fn();
    promptMock.mockReturnValueOnce(password).mockReturnValueOnce('wrong-password');
    corruptDownload = true;
    vi.mocked(importDocument).mockRejectedValueOnce(new Error('File format is not recognized'));
    render(React.createElement(RemoteStorage, { getSession: () => session, onOpen, notify }));
    await waitFor(() => expect(screen.getByText('Test User')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '現在の文書と画像を一時保管' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '復号して開く' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '復号して開く' }));
    await waitFor(() => expect(notify.mock.calls.some(([message]) => String(message).includes('File format is not recognized'))).toBe(true));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
