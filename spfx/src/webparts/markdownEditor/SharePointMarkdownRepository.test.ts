import type { SPHttpClientConfiguration, SPHttpClientResponse } from '@microsoft/sp-http';
import {
  SharePointMarkdownRepository,
  SharePointSaveConflictError,
  type ISharePointHttpClient
} from './SharePointMarkdownRepository';
import { decodeMarkdownBytes, encodeMarkdownBytes } from './MarkdownTextEncoding';

function response(options: {
  status?: number;
  json?: unknown;
  bytes?: number[];
  etag?: string;
  text?: string;
} = {}): SPHttpClientResponse {
  const status = options.status ?? 200;
  const bytes = Uint8Array.from(options.bytes || []);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 412 ? 'Precondition Failed' : 'OK',
    headers: { get: (name: string): string | null => name.toLowerCase() === 'etag' ? options.etag || null : null },
    json: async (): Promise<unknown> => options.json || {},
    arrayBuffer: async (): Promise<ArrayBuffer> => bytes.buffer,
    text: async (): Promise<string> => options.text || ''
  } as unknown as SPHttpClientResponse;
}

describe('SharePointMarkdownRepository', () => {
  const configuration = {} as SPHttpClientConfiguration;

  test('読込時のUTF-8 BOMとCRLFを保存時にも維持する', async () => {
    const source = Array.from(encodeMarkdownBytes('# 見出し\r\n本文\r\n', {
      encoding: 'utf-8',
      bom: true,
      lineEnding: '\r\n'
    }));
    let metadataCall = 0;
    const client: ISharePointHttpClient = {
      get: jest.fn(async (url: string) => {
        if (url.endsWith('/$value')) return response({ bytes: source });
        metadataCall += 1;
        return response({ json: { ETag: metadataCall === 1 ? '"old"' : '"new"', TimeLastModified: '2026-08-13T00:00:00Z' } });
      }),
      post: jest.fn(async () => response())
    };
    const repository = new SharePointMarkdownRepository(
      client,
      configuration,
      'https://example.sharepoint.com/sites/wiki/',
      "/sites/wiki/Docs/O'Hare.md"
    );

    const snapshot = await repository.load();
    expect(snapshot.content).toBe('# 見出し\r\n本文\r\n');
    expect(snapshot.format).toEqual({ encoding: 'utf-8', bom: true, lineEnding: '\r\n' });

    const saved = await repository.save('# 更新\n本文\n', snapshot);
    expect(saved.etag).toBe('"new"');
    expect(client.post).toHaveBeenCalledTimes(1);
    const [url, , options] = (client.post as jest.Mock).mock.calls[0];
    expect(url).toContain("O''Hare.md");
    expect(options.headers['IF-MATCH']).toBe('"old"');
    const body = new Uint8Array(options.body as ArrayBuffer);
    expect(Array.from(body.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(decodeMarkdownBytes(body).text).toBe('# 更新\r\n本文\r\n');
  });

  test('HTTP 412を上書きせず競合エラーに変換する', async () => {
    const client: ISharePointHttpClient = {
      get: jest.fn(),
      post: jest.fn(async () => response({ status: 412 }))
    };
    const repository = new SharePointMarkdownRepository(client, configuration, 'https://example.test', '/Docs/test.md');

    await expect(repository.save('更新', {
      content: '元',
      etag: '"old"',
      format: { encoding: 'utf-8', bom: false, lineEnding: '\n' }
    })).rejects.toBeInstanceOf(SharePointSaveConflictError);
    expect(client.get).not.toHaveBeenCalled();
  });
});
