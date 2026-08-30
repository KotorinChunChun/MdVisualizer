import type { SharePointAuthPrompt } from "../lib/sharePoint";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "../styles/sharepoint-auth.css";

export function SharePointAuthDialog({
  prompt,
  onOpenBrowser,
  onDismiss,
}: {
  prompt: SharePointAuthPrompt;
  onOpenBrowser: () => void;
  onDismiss: () => void;
}) {
  const dialogRef = useFocusTrap<HTMLElement>(true, onDismiss);
  return <div className="sharepoint-auth-backdrop" role="presentation">
    <section ref={dialogRef} className="sharepoint-auth-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="sharepoint-auth-title">
      <h2 id="sharepoint-auth-title">Microsoftへサインイン</h2>
      <p>ブラウザで次のコードを入力してください。サインインが完了すると文書を表示します。</p>
      <output className="sharepoint-auth-code" aria-label="サインインコード">{prompt.userCode}</output>
      <p className="sharepoint-auth-message">{prompt.message}</p>
      <div className="sharepoint-auth-actions">
        <button type="button" className="primary" onClick={onOpenBrowser}>サインインページを開く</button>
        <button type="button" onClick={() => void navigator.clipboard.writeText(prompt.userCode)}>コードをコピー</button>
        <button type="button" onClick={onDismiss}>案内を閉じる</button>
      </div>
    </section>
  </div>;
}
