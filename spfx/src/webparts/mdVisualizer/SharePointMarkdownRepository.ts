import type {
  ISPHttpClientOptions,
  SPHttpClientConfiguration,
  SPHttpClientResponse
} from '@microsoft/sp-http';
import {
  decodeMarkdownBytes,
  encodeMarkdownBytes,
  type IMarkdownBinaryFormat
} from './MarkdownTextEncoding';

export interface ISharePointHttpClient {
  get(url: string, configuration: SPHttpClientConfiguration, options?: ISPHttpClientOptions): Promise<SPHttpClientResponse>;
  post(url: string, configuration: SPHttpClientConfiguration, options: ISPHttpClientOptions): Promise<SPHttpClientResponse>;
}

export interface IMarkdownFileSnapshot {
  content: string;
  etag: string;
  format: IMarkdownBinaryFormat;
  lastModified?: string;
}

interface ISharePointFileMetadata {
  ETag?: string;
  TimeLastModified?: string;
}

export class SharePointSaveConflictError extends Error {
  public constructor() {
    super('SharePoint上のファイルが別のユーザーまたは処理によって更新されています。再読込して差分を確認してください。');
    this.name = 'SharePointSaveConflictError';
    Object.setPrototypeOf(this, SharePointSaveConflictError.prototype);
  }
}

export class SharePointMarkdownRepository {
  private readonly _fileEndpoint: string;

  public constructor(
    private readonly _client: ISharePointHttpClient,
    private readonly _configuration: SPHttpClientConfiguration,
    webUrl: string,
    serverRelativeFileUrl: string
  ) {
    const normalizedWebUrl = webUrl.replace(/\/$/, '');
    const escapedPath = serverRelativeFileUrl.replace(/'/g, "''");
    this._fileEndpoint = `${normalizedWebUrl}/_api/web/GetFileByServerRelativePath(decodedUrl='${escapedPath}')`;
  }

  public async load(): Promise<IMarkdownFileSnapshot> {
    const [metadata, contentResponse] = await Promise.all([
      this._loadMetadata(),
      this._client.get(`${this._fileEndpoint}/$value`, this._configuration, {
        headers: { Accept: 'application/octet-stream' }
      })
    ]);
    await this._ensureSuccess(contentResponse, 'Markdownファイルを読み込めませんでした。');
    const bytes = new Uint8Array(await contentResponse.arrayBuffer());
    const decoded = decodeMarkdownBytes(bytes);
    const etag = metadata.ETag || contentResponse.headers.get('ETag') || '';
    if (!etag) throw new Error('SharePointからeTagを取得できないため、安全な保存を開始できません。');
    return { content: decoded.text, format: decoded.format, etag, lastModified: metadata.TimeLastModified };
  }

  public async save(content: string, snapshot: IMarkdownFileSnapshot): Promise<IMarkdownFileSnapshot> {
    if (!snapshot.etag) throw new Error('保存に必要なeTagがありません。ファイルを再読込してください。');
    const payload = encodeMarkdownBytes(content, snapshot.format);
    const body = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    const response = await this._client.post(`${this._fileEndpoint}/$value`, this._configuration, {
      body,
      headers: {
        Accept: 'application/json;odata=nometadata',
        'Content-Type': 'application/octet-stream',
        'IF-MATCH': snapshot.etag,
        'X-HTTP-Method': 'PUT'
      }
    });
    if (response.status === 412) throw new SharePointSaveConflictError();
    await this._ensureSuccess(response, 'Markdownファイルを保存できませんでした。');
    const metadata = await this._loadMetadata();
    if (!metadata.ETag) throw new Error('保存は完了しましたが、新しいeTagを取得できませんでした。再読込してください。');
    return { content, format: snapshot.format, etag: metadata.ETag, lastModified: metadata.TimeLastModified };
  }

  private async _loadMetadata(): Promise<ISharePointFileMetadata> {
    const response = await this._client.get(
      `${this._fileEndpoint}?$select=ETag,TimeLastModified`,
      this._configuration,
      { headers: { Accept: 'application/json;odata=nometadata' } }
    );
    await this._ensureSuccess(response, 'SharePointファイルのメタデータを取得できませんでした。');
    return response.json() as Promise<ISharePointFileMetadata>;
  }

  private async _ensureSuccess(response: SPHttpClientResponse, prefix: string): Promise<void> {
    if (response.ok) return;
    let detail = '';
    try { detail = (await response.text()).slice(0, 500); } catch { /* status remains useful */ }
    throw new Error(`${prefix} HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
}
