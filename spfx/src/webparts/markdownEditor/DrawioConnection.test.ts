import { OFFICIAL_DRAWIO_ORIGIN, resolveDrawioConnection } from './DrawioConnection';

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
});
