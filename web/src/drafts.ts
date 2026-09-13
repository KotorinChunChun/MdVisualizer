import type { DocumentSession } from './documentSession';
export interface StoredDraft extends DocumentSession { updated: number }
const databaseName = 'mdvisualizer-web-v2';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('ブラウザー内の下書きを利用できません。'));
    request.onblocked = () => reject(new Error('下書き保存が別の画面により待機しています。'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction('drafts', mode), request = operation(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('下書き保存・復元に失敗しました。ブラウザーの容量を確認してください。'));
    });
  } finally { database.close(); }
}
export const loadDraft = () => transaction<StoredDraft | undefined>('readonly', store => store.get('current'));
export const saveDraft = (session: DocumentSession) => transaction('readwrite', store => store.put({ ...session, updated: Date.now() } satisfies StoredDraft, 'current'));
export const clearDraft = () => transaction('readwrite', store => store.delete('current'));
