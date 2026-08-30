import { type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { SHORTCUTS } from "../lib/shortcuts";
import { APP_INFO } from "../lib/appInfo";
import { openExternalUrl } from "../lib/commands";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "../styles/shortcut-help.css";

function openProjectLink(event: MouseEvent<HTMLAnchorElement>, url: string) {
  event.preventDefault();
  void openExternalUrl(url).catch((error) => {
    window.dispatchEvent(new CustomEvent("markdown-toast", {
      detail: { type: "error", message: String(error) },
    }));
  });
}

export function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);

  return createPortal(
    <div ref={modalRef} className="shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" tabIndex={-1} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="shortcut-help__window">
        <header>
          <h2 id="shortcut-help-title">ショートカットキー</h2>
          <button type="button" aria-label="ショートカット一覧を閉じる" onClick={onClose}>×</button>
        </header>
        <dl className="shortcut-help__shortcuts">
          {SHORTCUTS.map((shortcut) => <div key={shortcut.keys}>
            <dt><kbd>{shortcut.keys}</kbd></dt>
            <dd>{shortcut.description}</dd>
          </div>)}
        </dl>
        <section className="shortcut-help__app-info" aria-labelledby="shortcut-help-app-info-title">
          <h3 id="shortcut-help-app-info-title">バージョン情報</h3>
          <dl>
            <div><dt>更新日</dt><dd>{APP_INFO.updatedAt}</dd></div>
            <div><dt>バージョン</dt><dd>{APP_INFO.version}</dd></div>
            <div><dt>作者</dt><dd>{APP_INFO.author}</dd></div>
            <div><dt>GitHub README</dt><dd><a href={APP_INFO.readmeUrl} onClick={(event) => openProjectLink(event, APP_INFO.readmeUrl)}>READMEを開く</a></dd></div>
            <div><dt>GitHubリリース</dt><dd><a href={APP_INFO.releasesUrl} onClick={(event) => openProjectLink(event, APP_INFO.releasesUrl)}>リリースを開く</a></dd></div>
          </dl>
        </section>
      </section>
    </div>,
    document.body,
  );
}
