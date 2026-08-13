export type DrawioConnectionMode = 'disabled' | 'official' | 'selfHosted' | 'tenantSite';

export interface IDrawioConnectionProperties {
  mode?: DrawioConnectionMode;
  editorUrl?: string;
  viewerUrl?: string;
  sharePointPageUrl?: string;
}

export interface IResolvedDrawioConnection {
  mode: DrawioConnectionMode;
  enabled: boolean;
  editorUrl?: URL;
  viewerUrl?: URL;
  external: boolean;
}

export const OFFICIAL_DRAWIO_ORIGIN = 'https://embed.diagrams.net';
export const OFFICIAL_DRAWIO_EDITOR_URL = `${OFFICIAL_DRAWIO_ORIGIN}/?embed=1&proto=json&spin=1&libraries=1&noSaveBtn=1`;

function httpsUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label}は資格情報を含まないHTTPS URLで指定してください。`);
  return url;
}

export function resolveDrawioConnection(
  properties: IDrawioConnectionProperties,
  currentWebUrl: string
): IResolvedDrawioConnection {
  const mode = properties.mode || 'official';
  if (mode === 'disabled') return { mode, enabled: false, external: false };
  if (mode === 'official') {
    return { mode, enabled: true, editorUrl: new URL(OFFICIAL_DRAWIO_EDITOR_URL), external: true };
  }
  if (mode === 'selfHosted') {
    const editorUrl = httpsUrl(properties.editorUrl || '', '自社draw.io Editor URL');
    const viewerUrl = properties.viewerUrl ? httpsUrl(properties.viewerUrl, '自社draw.io Viewer URL') : undefined;
    return { mode, enabled: true, editorUrl, viewerUrl, external: editorUrl.origin !== new URL(currentWebUrl).origin };
  }
  const editorUrl = httpsUrl(properties.sharePointPageUrl || '', 'SharePoint draw.ioページURL');
  if (editorUrl.origin !== new URL(currentWebUrl).origin) {
    throw new Error('指定サイトのdraw.ioページは現在のSharePointと同一オリジンである必要があります。');
  }
  return { mode, enabled: true, editorUrl, external: false };
}
