import { OFFICIAL_DRAWIO_ORIGIN, resolveDrawioConnection } from './DrawioConnection';
import { parseTrustedDrawioMessage } from './DrawioEditorBridge';

describe('resolveDrawioConnection', () => {
  it('uses the official editor only for official mode', () => {
    expect(resolveDrawioConnection({ mode: 'official' }, 'https://tenant.sharepoint.com/sites/wiki').editorUrl?.origin)
      .toBe(OFFICIAL_DRAWIO_ORIGIN);
  });

  it('accepts a same-origin SharePoint page and rejects another host', () => {
    expect(resolveDrawioConnection({
      mode: 'tenantSite',
      sharePointPageUrl: 'https://tenant.sharepoint.com/sites/tools/SitePages/drawio.aspx'
    }, 'https://tenant.sharepoint.com/sites/wiki').external).toBe(false);
    expect(() => resolveDrawioConnection({
      mode: 'tenantSite',
      sharePointPageUrl: 'https://other.example/drawio'
    }, 'https://tenant.sharepoint.com/sites/wiki')).toThrow('同一オリジン');
  });

  it('accepts only credential-free HTTPS URLs for a self-hosted editor', () => {
    const connection = resolveDrawioConnection({
      mode: 'selfHosted',
      editorUrl: 'https://drawio.example.com/editor?embed=1',
      viewerUrl: 'https://drawio.example.com/viewer'
    }, 'https://tenant.sharepoint.com/sites/wiki');
    expect(connection.editorUrl?.origin).toBe('https://drawio.example.com');
    expect(connection.external).toBe(true);
    expect(() => resolveDrawioConnection({
      mode: 'selfHosted',
      editorUrl: 'http://drawio.example.com/editor'
    }, 'https://tenant.sharepoint.com/sites/wiki')).toThrow('HTTPS URL');
  });

  it('accepts messages only from the configured iframe and origin', () => {
    const source = {} as MessageEventSource;
    const trusted = { source, origin: OFFICIAL_DRAWIO_ORIGIN, data: '{"event":"init"}' };
    expect(parseTrustedDrawioMessage(trusted, source, OFFICIAL_DRAWIO_ORIGIN)).toEqual({ event: 'init' });
    expect(parseTrustedDrawioMessage({ ...trusted, origin: 'https://evil.example' }, source, OFFICIAL_DRAWIO_ORIGIN)).toBeUndefined();
    expect(parseTrustedDrawioMessage({ ...trusted, source: {} as MessageEventSource }, source, OFFICIAL_DRAWIO_ORIGIN)).toBeUndefined();
    expect(parseTrustedDrawioMessage({ ...trusted, data: 'not-json' }, source, OFFICIAL_DRAWIO_ORIGIN)).toBeUndefined();
  });
});
