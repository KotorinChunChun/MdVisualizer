import type { SPHttpClientConfiguration, SPHttpClientResponse } from '@microsoft/sp-http';
import { SharePointMarkdownFileBrowser } from './SharePointMarkdownFileBrowser';
import type { ISharePointHttpClient } from './SharePointMarkdownRepository';

function jsonResponse(value: unknown): SPHttpClientResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async (): Promise<unknown> => value
  } as unknown as SPHttpClientResponse;
}

describe('SharePointMarkdownFileBrowser', () => {
  test('文書ライブラリを再帰走査して.mdと.markdownだけを返す', async () => {
    const client: ISharePointHttpClient = {
      get: jest.fn(async (url: string) => {
        if (url.includes('/_api/web/lists?')) {
          return jsonResponse({ value: [{
            Id: 'library-id',
            Title: 'Wiki',
            RootFolder: { Name: 'SpoWiki', ServerRelativeUrl: '/sites/team/SpoWiki' }
          }] });
        }
        if (url.includes("decodedUrl='/sites/team/SpoWiki'") && url.includes('/Files?')) {
          return jsonResponse({ value: [
            { Name: 'README.md', ServerRelativeUrl: '/sites/team/SpoWiki/README.md' },
            { Name: '除外.txt', ServerRelativeUrl: '/sites/team/SpoWiki/除外.txt' }
          ] });
        }
        if (url.includes("decodedUrl='/sites/team/SpoWiki'") && url.includes('/Folders?')) {
          return jsonResponse({ value: [{ Name: 'Guides', ServerRelativeUrl: '/sites/team/SpoWiki/Guides' }] });
        }
        if (url.includes("decodedUrl='/sites/team/SpoWiki/Guides'") && url.includes('/Files?')) {
          return jsonResponse({
            value: [{ Name: '設計.markdown', ServerRelativeUrl: '/sites/team/SpoWiki/Guides/設計.markdown' }],
            '@odata.nextLink': 'https://example.test/next-files'
          });
        }
        if (url === 'https://example.test/next-files') {
          return jsonResponse({ value: [{ Name: '追補.MD', ServerRelativeUrl: '/sites/team/SpoWiki/Guides/追補.MD' }] });
        }
        if (url.includes("decodedUrl='/sites/team/SpoWiki/Guides'") && url.includes('/Folders?')) {
          return jsonResponse({ value: [] });
        }
        throw new Error(`想定外のURL: ${url}`);
      }),
      post: jest.fn()
    };
    const browser = new SharePointMarkdownFileBrowser(
      client,
      {} as SPHttpClientConfiguration,
      'https://example.sharepoint.com/sites/team/'
    );

    const files = await browser.list('SpoWiki');
    expect(files.map(file => file.relativeFilePath)).toEqual([
      'Guides/設計.markdown',
      'Guides/追補.MD',
      'README.md'
    ]);
    expect(files.every(file => file.libraryTitle === 'Wiki')).toBe(true);
  });

  test('存在しないライブラリ指定を明示的に拒否する', async () => {
    const client: ISharePointHttpClient = {
      get: jest.fn(async () => jsonResponse({ value: [] })),
      post: jest.fn()
    };
    const browser = new SharePointMarkdownFileBrowser(client, {} as SPHttpClientConfiguration, 'https://example.test');
    await expect(browser.list('NotFound')).rejects.toThrow('文書ライブラリ「NotFound」が見つかりませんでした。');
  });

  test('サブフォルダーから文書ライブラリ外への相対移動を拒否する', async () => {
    const client: ISharePointHttpClient = {
      get: jest.fn(async () => jsonResponse({ value: [{
        Id: 'library-id',
        Title: 'Wiki',
        RootFolder: { Name: 'Wiki', ServerRelativeUrl: '/sites/team/Wiki' }
      }] })),
      post: jest.fn()
    };
    const browser = new SharePointMarkdownFileBrowser(client, {} as SPHttpClientConfiguration, 'https://example.test');
    await expect(browser.list('Wiki', '../OtherLibrary')).rejects.toThrow('相対移動');
  });
});
