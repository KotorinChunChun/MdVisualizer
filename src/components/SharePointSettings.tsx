import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ConnectionInfo {
  clientId: string;
  tenant: string;
  directProtocolRegistration: boolean;
}

export function SharePointSettings({ onOpen }: { onOpen: (path: string) => void }) {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(0);
  useEffect(() => {
    let disposed = false;
    setInfo(null);
    setError(null);
    void invoke<ConnectionInfo>("sharepoint_connection_info").then(result => {
      if (!disposed) setInfo(result);
    }).catch(() => {
      if (!disposed) setError("連携情報を取得できませんでした。「状態を再確認」で再試行してください。");
    });
    return () => { disposed = true; };
  }, [checking]);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await invoke<string>("validate_sharepoint_uri", { value });
      if (mounted.current) onOpen(path);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return <fieldset className="settings-section sharepoint-settings">
    <legend>SharePoint連携</legend>
    <p>Microsoft組織アカウントでサインインします。認証設定は組み込み済みで、テナントID・アプリケーションID・クライアントシークレットの入力は不要です。</p>
    {info && <dl>
      <dt>アプリケーションID</dt><dd>{info.clientId}</dd>
      <dt>認証先</dt><dd>{info.tenant}（所属組織）</dd>
      <dt>この実行ファイルへのspmd直接登録</dt><dd>{info.directProtocolRegistration ? "確認できました" : "確認できませんでした（MSIXの登録は別方式です）"}</dd>
    </dl>}
    <button type="button" onClick={() => setChecking(current => current + 1)}>状態を再確認</button>
    <p>ブラウザーからアプリが起動しない場合は、インストール版の更新とWindowsの既定のアプリでspmdの関連付けを確認してください。ポータブル版や開発版は自動登録しません。上の登録確認はSharePointへの接続成功を意味しません。</p>
    <label>SharePointファイルのURL
      <input type="text" value={value} disabled={busy} onChange={event => setValue(event.target.value)} placeholder="spmd://contoso.sharepoint.com/sites/site/Documents/README.md" />
    </label>
    <button type="button" disabled={busy || !value.trim()} onClick={() => void open()}>{busy ? "形式を確認中…" : "URLを確認して開く"}</button>
    <p>spmd:// または https:// のファイル直接URL（.md／.markdown）を指定します。共有リンク、Forms/AllItems.aspx、クエリ・フラグメント付きURLは使用できません。URLは設定に保存しません。</p>
    <p>アプリが起動してから失敗する場合は、URL・閲覧権限・組織の同意ポリシーを確認してください。初回は表示されたデバイスコードをMicrosoftのページに入力します。SPFx公開用のMicrosoft 365 CLIのログインとは別の認証です。</p>
    {error && <p role="alert" className="settings-error">{error}</p>}
  </fieldset>;
}
