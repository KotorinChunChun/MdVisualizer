import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './drafts';
import type { DocumentSession } from './documentSession';

type DraftDatabaseControl = {
  records: Map<string, unknown>;
  failOpen: boolean;
  failWrite: boolean;
};

const control: DraftDatabaseControl = { records: new Map(), failOpen: false, failWrite: false };

function installIndexedDb(): void {
  const factory = {
    open() {
      const request: any = { result: undefined, error: undefined, onupgradeneeded: undefined, onsuccess: undefined, onerror: undefined, onblocked: undefined };
      setTimeout(() => {
        if (control.failOpen) {
          request.error = new Error('open failed');
          request.onerror?.(new Event('error'));
          return;
        }
        request.result = {
          createObjectStore() { return {}; },
          transaction(_name: string, mode: IDBTransactionMode) {
            const pending: Array<{ kind: 'put' | 'delete'; key: string; value?: unknown }> = [];
            const transaction: any = {
              objectStore() {
                return {
                  get(key: string) {
                    const result = control.records.get(key);
                    return { result };
                  },
                  put(value: unknown, key: string) {
                    pending.push({ kind: 'put', key, value });
                    return { result: key };
                  },
                  delete(key: string) {
                    pending.push({ kind: 'delete', key });
                    return { result: undefined };
                  },
                };
              },
              oncomplete: undefined,
              onerror: undefined,
              onabort: undefined,
            };
            setTimeout(() => {
              if (mode === 'readwrite' && control.failWrite) {
                transaction.error = new Error('write failed');
                transaction.onabort?.(new Event('abort'));
                transaction.onerror?.(new Event('error'));
                return;
              }
              for (const action of pending) {
                if (action.kind === 'put') control.records.set(action.key, action.value);
                else control.records.delete(action.key);
              }
              transaction.oncomplete?.(new Event('complete'));
            }, 0);
            return transaction;
          },
          close() {},
        };
        if (!control.records.has('__database_initialized__')) {
          control.records.set('__database_initialized__', true);
          request.onupgradeneeded?.(new Event('upgradeneeded'));
          control.records.delete('__database_initialized__');
        }
        request.onsuccess?.(new Event('success'));
      }, 0);
      return request;
    },
  } as unknown as IDBFactory;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
}

const session: DocumentSession = {
  name: 'docs/note.md',
  markdown: '# 下書き\r\n\r\n![画像](../images/a.png)\r\n',
  encoding: 'UTF-16LE',
  bom: true,
  assets: [{ path: 'images/a.png', blob: new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'image/png' }) }],
};

describe('IndexedDB下書き保存', () => {
  beforeEach(() => {
    control.records.clear();
    control.failOpen = false;
    control.failWrite = false;
    installIndexedDb();
  });

  it('文書の文字コード・BOM・画像Blobを保存して復元できる', async () => {
    await saveDraft(session);
    const restored = await loadDraft();

    expect(restored?.name).toBe(session.name);
    expect(restored?.markdown).toBe(session.markdown);
    expect(restored?.encoding).toBe(session.encoding);
    expect(restored?.bom).toBe(true);
    expect(restored?.assets).toHaveLength(1);
    expect(restored?.assets[0].path).toBe('images/a.png');
    expect(restored?.assets[0].blob.type).toBe('image/png');
    expect(new Uint8Array(await restored!.assets[0].blob.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(restored?.updated).toEqual(expect.any(Number));
  });

  it('下書きを削除すると復元結果が空になる', async () => {
    await saveDraft(session);
    await clearDraft();
    await expect(loadDraft()).resolves.toBeUndefined();
  });

  it('保存トランザクションが失敗しても既存下書きを破壊しない', async () => {
    await saveDraft(session);
    const changed = { ...session, markdown: '# 変更後', assets: [] };
    control.failWrite = true;

    await expect(saveDraft(changed)).rejects.toThrow('下書き保存・復元に失敗しました');
    control.failWrite = false;
    const preserved = await loadDraft();
    expect(preserved?.markdown).toBe(session.markdown);
    expect(preserved?.assets).toHaveLength(1);
  });

  it('IndexedDBを開けない場合は利用不能エラーを返す', async () => {
    control.failOpen = true;
    await expect(loadDraft()).rejects.toThrow('ブラウザー内の下書きを利用できません');
  });
});
