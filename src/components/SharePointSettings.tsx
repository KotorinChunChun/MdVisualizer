import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { sharePointLaunchNeedsSettings } from "../lib/sharePoint";

interface ConnectionInfo { clientId: string; tenant: string; directProtocolRegistration: boolean }
interface ReceivedUri { value: string; receivedAt: string; origin: string; error: string | null }
interface Entry { name: string; uri: string; folder: boolean }
interface Listing { uri: string; parentUri: string | null; entries: Entry[] }

export function SharePointSettings({ onOpen, onSettled, authenticationReady = true }: {
  onOpen: (path: string) => void; onSettled?: () => void; authenticationReady?: boolean;
}) {
  const mounted = useRef(false);
  const request = useRef(0);
  const edited = useRef(false);
  const automatic = useRef<string | null>(null);
  const latestReceivedAt = useRef(-Infinity);
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [received, setReceived] = useState<ReceivedUri | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);

  const receive = (item: ReceivedUri | null) => {
    if (!mounted.current || !item) return;
    const time = Date.parse(item.receivedAt);
    if (time < latestReceivedAt.current) return;
    latestReceivedAt.current = time;
    setReceived(item);
    setCopied(false);
    if (!edited.current) setValue(item.value);
  };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ReceivedUri>("sharepoint-uri-received", event => { if (!disposed) receive(event.payload); })
      .then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    void invoke<ConnectionInfo>("sharepoint_connection_info").then(result => {
      if (!disposed) setInfo(result);
    }).catch(() => { if (!disposed) setError("連携情報を取得できませんでした。「状態を再確認」で再試行してください。"); });
    void invoke<ReceivedUri | null>("last_sharepoint_uri").then(item => { if (!disposed) receive(item); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [checking]);

  const browse = async (uri: string) => {
    const id = ++request.current;
    setBusy(true); setError(null); setCopied(false);
    try {
      const result = await invoke<Listing>("list_sharepoint_folder", { value: uri });
      if (mounted.current && id === request.current) { setListing(result); setValue(result.uri.replace(/^spmd:/i,"https:")); }
    } catch (reason) {
      if (mounted.current && id === request.current) setError(String(reason));
    } finally {
      if (mounted.current && id === request.current) { setBusy(false); onSettled?.(); }
    }
  };
  const open = async () => {
    const id = ++request.current;
    setBusy(true); setError(null);
    try {
      const uri = await invoke<string>("validate_sharepoint_uri", { value });
      if (!mounted.current || id !== request.current) return;
      if (sharePointLaunchNeedsSettings(uri)) await browse(uri);
      else onOpen(uri);
    } catch (reason) { if (mounted.current && id === request.current) setError(String(reason)); }
    finally {
      if (mounted.current && id === request.current) setBusy(false);
      if (mounted.current) void invoke<ReceivedUri | null>("last_sharepoint_uri").then(receive).catch(() => undefined);
    }
  };
  // 起動URLがライブラリを指す場合は、認証案内の購読後にその一覧を開く。
  useEffect(() => {
    if (!authenticationReady || !received || received.error || received.origin === "URL入力" || automatic.current === received.receivedAt) return;
    if (!sharePointLaunchNeedsSettings(received.value.replace(/^https:/i,"spmd:"))) return;
    automatic.current = received.receivedAt;
    void browse(received.value);
  }, [received?.receivedAt, authenticationReady]);
  const copy = async () => {
    if (!received) return;
    try { await navigator.clipboard.writeText(received.value); if (mounted.current) setCopied(true); }
    catch { if (mounted.current) setError("受信URLをコピーできませんでした。欄を選択してCtrl+Cでコピーしてください。"); }
  };
  return <fieldset className="settings-section sharepoint-settings">
    <legend>SharePoint連携</legend>
    {info && <dl>
      <dt>アプリケーションID</dt><dd>{info.clientId}</dd>
      <dt>認証先</dt><dd>{info.tenant}（所属組織）</dd>
      <dt>この実行ファイルへのspmd直接登録</dt><dd title="MSIXの関連付けはWindowsが管理します。この確認はSharePointへの接続結果ではありません。">{info.directProtocolRegistration ? "確認できました" : "確認できませんでした（MSIXの登録は別方式です）"}</dd>
    </dl>}
    <button type="button" title="関連付けと直前の受信URLを再確認" onClick={() => { setError(null); setChecking(current => current + 1); }}>状態を再確認</button>
    <label>SharePointのURL
      <input type="text" value={value} disabled={busy} onChange={event => { edited.current = true; setValue(event.target.value); }} placeholder="https://contoso.sharepoint.com/Wiki" title="HTTPSまたはspmdのMarkdown直接URL、ライブラリ、フォルダー。HTMLページや共有リンクは対象外です。" />
    </label>
    <button type="button" disabled={busy || !value.trim() || !authenticationReady} title="Markdownは直接開き、ライブラリ／フォルダーはファイルを選びます" onClick={() => void open()}>{busy ? "読込中…" : "URLを開く"}</button>
    {listing && <div role="group" aria-label="SharePointのMarkdownファイル">
      {listing.parentUri && <button type="button" disabled={busy} title="同じライブラリ内の親フォルダーへ移動" onClick={() => void browse(listing.parentUri!)}>親フォルダー</button>}
      <ul className="sharepoint-file-list">{listing.entries.map(entry => <li key={entry.uri}>
        <button type="button" disabled={busy} title={entry.uri.replace(/^spmd:/i,"https:")} onClick={() => entry.folder ? void browse(entry.uri) : onOpen(entry.uri)}>{entry.name}{entry.folder ? "/" : ""}</button>
      </li>)}</ul>
      {listing.entries.length === 0 && <output>Markdownファイルまたはフォルダーがありません。</output>}
    </div>}
    <label>直前の受信URL
      <textarea readOnly rows={2} value={received?.value ?? ""} placeholder="受信履歴はありません" title="受信した原文です。再起動で消え、設定やログへ自動保存しません。" />
    </label>
    {received && <dl><dt>受信日時</dt><dd><time dateTime={received.receivedAt}>{new Date(received.receivedAt).toLocaleString()}</time></dd><dt>受信経路</dt><dd>{received.origin}</dd>
      {received.error && <><dt>URLの検証結果</dt><dd className="sharepoint-received-error">{received.error}</dd></>}
    </dl>}
    <button type="button" disabled={!received} title="直前に受信したURLの原文をコピー" onClick={() => void copy()}>受信URLをコピー</button>
    {copied && <output role="status">受信URLをコピーしました。</output>}
    {error && <p role="alert" className="settings-error">{error}</p>}
  </fieldset>;
}
