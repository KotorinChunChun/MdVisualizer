import { useEffect, useRef } from "react";
import { TabState } from "../state/tabsReducer";
import { openContainingFolder, openExternalUrl, openInEditor } from "../lib/commands";
import { isSharePointDocument, sharePointLibraryViewUrl } from "../lib/sharePoint";

export function ContextMenu({ tab, x, y, onClose, onCloseOthers, onCloseRight, onNewWindow, onResult, onError, onDismiss }: { tab: TabState; x: number; y: number; onClose: () => void; onCloseOthers: () => void; onCloseRight: () => void; onNewWindow?: () => void | Promise<void>; onResult: (message: string) => void; onError: (message: string) => void; onDismiss: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.focus();
    const dismissOnBlur = () => onDismiss();
    window.addEventListener("blur", dismissOnBlur);
    return () => window.removeEventListener("blur", dismissOnBlur);
  }, [onDismiss]);
  const run = (successMessage: string, operation: () => void | Promise<void>) => {
    onDismiss();
    void Promise.resolve()
      .then(operation)
      .then(() => onResult(successMessage))
      .catch((error) => onError(String(error)));
  };
  const copy = (value: string, label: string) => run(`${label}をコピーしました`, () => navigator.clipboard.writeText(value));
  const sharePoint = isSharePointDocument(tab.document ?? tab);
  const sharePointUrl = sharePoint ? sharePointLibraryViewUrl(tab.path) : null;
  const untitled = Boolean(tab.untitled);
  return <div ref={menuRef} className="context-menu" style={{ left: x, top: y }} tabIndex={-1} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDismiss(); }}>
    <button onClick={() => copy(tab.path.split(/[\\/]/).pop() ?? tab.path, "ファイル名")}>ファイル名をコピー</button>
    <button onClick={() => copy(tab.path, sharePoint ? "spmd URI" : "フルパス")}>{sharePoint ? "spmd URIをコピー" : "フルパスをコピー"}</button>
    {sharePoint ? <button onClick={() => sharePointUrl && run("SharePointをブラウザーで開きました", () => openExternalUrl(sharePointUrl))} disabled={!sharePointUrl}>SharePointで開く</button> : <>
      <button disabled={untitled} onClick={() => run("フォルダーを開きました", () => openContainingFolder(tab.path))}>フォルダを開く</button>
      <button disabled={untitled} onClick={() => run("VS Codeで開きました", () => openInEditor(tab.path, "vscode"))}>VS Code で開く</button>
      <button disabled={untitled} onClick={() => run("メモ帳で開きました", () => openInEditor(tab.path, "notepad"))}>メモ帳で開く</button>
    </>}
    <button onClick={() => run("タブを閉じました", onClose)}>タブを閉じる</button>
    <button onClick={() => run("他のタブを閉じました", onCloseOthers)}>他のタブを閉じる</button>
    <button onClick={() => run("右側のタブを閉じました", onCloseRight)}>右側のタブを閉じる</button>
    <button disabled={!onNewWindow} onClick={() => onNewWindow && run("別ウィンドウで開きました", onNewWindow)}>別ウィンドウで開く</button>
  </div>;
}
