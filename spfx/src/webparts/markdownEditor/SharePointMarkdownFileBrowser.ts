import { isMarkdownDocumentName } from '@markdown-viewer/markdown-core';
import type { SPHttpClientConfiguration, SPHttpClientResponse } from '@microsoft/sp-http';
import type { ISharePointHttpClient } from './SharePointMarkdownRepository';

interface IODataCollection<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

interface ILibraryResponse {
  Id: string;
  Title: string;
  RootFolder?: { Name?: string; ServerRelativeUrl?: string };
}

interface IFileResponse {
  Name?: string;
  ServerRelativeUrl?: string;
  TimeLastModified?: string;
}

interface IFolderResponse {
  Name?: string;
  ServerRelativeUrl?: string;
}

export interface ISharePointDocumentLibrary {
  id: string;
  title: string;
  rootFolderName: string;
  rootFolderServerRelativeUrl: string;
}

export interface ISharePointMarkdownFile {
  name: string;
  serverRelativeUrl: string;
  libraryTitle: string;
  relativeFilePath: string;
  lastModified?: string;
}

export class SharePointMarkdownFileBrowser {
  private readonly _webUrl: string;

  public constructor(
    private readonly _client: ISharePointHttpClient,
    private readonly _configuration: SPHttpClientConfiguration,
    webUrl: string
  ) {
    this._webUrl = webUrl.replace(/\/$/, '');
  }

  public async listLibraries(): Promise<ISharePointDocumentLibrary[]> {
    const url = `${this._webUrl}/_api/web/lists?` +
      '$select=Id,Title,RootFolder/Name,RootFolder/ServerRelativeUrl&$expand=RootFolder&' +
      '$filter=Hidden%20eq%20false%20and%20BaseTemplate%20eq%20101&$top=5000';
    const response = await this._client.get(url, this._configuration, { headers: { Accept: 'application/json;odata=nometadata' } });
    await this._ensureSuccess(response, 'SharePointの文書ライブラリ一覧を取得できませんでした。');
    const rows = (await response.json() as IODataCollection<ILibraryResponse>).value || [];
    return rows.map(row => ({
      id: row.Id,
      title: row.Title,
      rootFolderName: row.RootFolder?.Name || row.Title,
      rootFolderServerRelativeUrl: row.RootFolder?.ServerRelativeUrl || ''
    })).filter(row => row.rootFolderServerRelativeUrl);
  }

  public async list(librarySelector = '', subfolder = ''): Promise<ISharePointMarkdownFile[]> {
    const libraries = await this.listLibraries();
    const selector = this._normalize(librarySelector).toLocaleLowerCase('ja');
    const selected = selector ? libraries.filter(library => [library.title, library.rootFolderName]
      .some(value => this._normalize(value).toLocaleLowerCase('ja') === selector)) : libraries;
    if (selector && selected.length === 0) throw new Error(`文書ライブラリ「${librarySelector}」が見つかりませんでした。`);
    const result = await Promise.all(selected.map(library => this._listLibrary(library, subfolder)));
    return ([] as ISharePointMarkdownFile[]).concat(...result)
      .sort((left, right) => left.serverRelativeUrl.localeCompare(right.serverRelativeUrl, 'ja'));
  }

  private async _listLibrary(library: ISharePointDocumentLibrary, subfolder: string): Promise<ISharePointMarkdownFile[]> {
    const result: ISharePointMarkdownFile[] = [];
    const root = `/${this._normalize(library.rootFolderServerRelativeUrl)}`;
    const child = this._normalize(subfolder);
    const queue = [`${root}${child ? `/${child}` : ''}`];
    while (queue.length > 0) {
      const folder = queue.shift() as string;
      const endpoint = `${this._webUrl}/_api/web/GetFolderByServerRelativePath(decodedUrl='${folder.replace(/'/g, "''")}')`;
      const [files, folders] = await Promise.all([
        this._getCollection<IFileResponse>(`${endpoint}/Files?$select=Name,ServerRelativeUrl,TimeLastModified&$top=5000`),
        this._getCollection<IFolderResponse>(`${endpoint}/Folders?$select=Name,ServerRelativeUrl&$top=5000`)
      ]);
      files.forEach(file => {
        if (!file.Name || !file.ServerRelativeUrl || !isMarkdownDocumentName(file.Name)) return;
        const normalized = `/${this._normalize(file.ServerRelativeUrl)}`;
        result.push({
          name: file.Name,
          serverRelativeUrl: normalized,
          libraryTitle: library.title,
          relativeFilePath: normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : file.Name,
          lastModified: file.TimeLastModified
        });
      });
      folders.forEach(folderRow => { if (folderRow.ServerRelativeUrl) queue.push(`/${this._normalize(folderRow.ServerRelativeUrl)}`); });
    }
    return result;
  }

  private async _getCollection<T>(initialUrl: string): Promise<T[]> {
    const rows: T[] = [];
    let url: string | undefined = initialUrl;
    while (url) {
      const response = await this._client.get(url, this._configuration, { headers: { Accept: 'application/json;odata=nometadata' } });
      await this._ensureSuccess(response, 'SharePointのファイル一覧を取得できませんでした。');
      const page = await response.json() as IODataCollection<T>;
      rows.push(...(page.value || []));
      url = page['@odata.nextLink'];
    }
    return rows;
  }

  private _normalize(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  }

  private async _ensureSuccess(response: SPHttpClientResponse, prefix: string): Promise<void> {
    if (response.ok) return;
    throw new Error(`${prefix} HTTP ${response.status} ${response.statusText}`);
  }
}
