import { useEffect, useRef, useState } from 'react';
import { importDocument, sessionZip, type DocumentSession } from './documentSession';
type Item = { id: string; name: string; expires: number; bytes: number };
type Session = { user: { name: string; provider: string } | null; csrf: string; loginUrl: string | null; logoutUrl: string | null; storageAvailable: boolean };
export function RemoteStorage({ getSession, onOpen, notify }: { getSession: () => DocumentSession; onOpen: (value: DocumentSession) => boolean | void; notify: (message: string) => void }) {
  const [auth, setAuth] = useState<Session | null>(null), [items, setItems] = useState<Item[]>([]), [busy, setBusy] = useState(false);
  const started = useRef(false), operationRunning = useRef(false);
  async function request(action: string, init?: RequestInit) {
    const response = await fetch(`api.php?action=${action}`, { ...init, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `一時保管の処理に失敗しました (${response.status})。`); }
    return response;
  }
  async function refresh() {
    const session = await (await request('session')).json() as Session;
    setAuth(session); setItems(session.user && session.storageAvailable ? (await (await request('list')).json()).items : []);
  }
  useEffect(() => { if (started.current) return; started.current = true; void refresh().catch(error => notify(String(error.message))); }, []);
  async function perform(operation: () => Promise<void>) { if (operationRunning.current) return; operationRunning.current = true; setBusy(true); try { await operation(); } catch (error) { notify(error instanceof Error ? error.message : String(error)); } finally { operationRunning.current = false; setBusy(false); } }
  const post = (body?: Blob): RequestInit => ({ method: 'POST', headers: { 'X-CSRF-Token': auth?.csrf ?? '', ...(body ? { 'Content-Type': 'application/zip' } : {}) }, body });
  async function store() {
    const password = prompt('一時保管用パスワードを指定してください。サーバーには保存されず、忘れた場合は復元できません。');
    if (!password) return;
    const snapshot = getSession();
    const blob = await sessionZip(snapshot, password);
    await request('store', post(blob)); await refresh(); notify('文書と画像を暗号化して10日間一時保管しました。');
  }
  async function open(item: Item) {
    const password = prompt('保管時に指定したパスワードを入力してください。'); if (!password) return;
    const blob = await (await request(`download&id=${encodeURIComponent(item.id)}`)).blob();
    const next = await importDocument(blob, password); if (onOpen(next) !== false) notify('文書と画像を復元しました。');
  }
  return <section className="remote-storage" aria-label="暗号化一時保管">
    <strong>暗号化一時保管</strong><p>明示的に保管した文書と画像を10日間お預かりします。</p>
    {!auth && <span>状態を確認しています…</span>}
    {auth && !auth.storageAvailable && <p>サーバーの一時保管設定は準備中です。編集とダウンロードは利用できます。</p>}
    {auth && !auth.user && auth.loginUrl && <a href={auth.loginUrl}>Googleでサインイン</a>}
    {auth && !auth.user && !auth.loginUrl && <p>サイトのGoogleログイン設定は準備中です。</p>}
    {auth?.user && <><span>{auth.user.name}</span><button type="button" disabled={busy || !auth.storageAvailable} onClick={() => void perform(store)}>現在の文書と画像を一時保管</button>{auth.logoutUrl && <a href={auth.logoutUrl} onClick={(event) => { if (!confirm('サイト全体からサインアウトします。必要な編集内容は先に保存してください。')) event.preventDefault(); }}>サイトからサインアウト</a>}
      {items.map(item => <div key={item.id}><span>{item.name}（{new Date(item.expires * 1000).toLocaleString()}まで）</span><button type="button" disabled={busy} onClick={() => void perform(() => open(item))}>復号して開く</button><button type="button" disabled={busy} onClick={() => { if (confirm('この保管データを削除しますか？')) void perform(async () => { await request(`delete&id=${encodeURIComponent(item.id)}`, post()); await refresh(); }); }}>削除</button></div>)}</>}
  </section>;
}
