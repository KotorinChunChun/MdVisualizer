import { useEffect, useRef } from "react";
import { TabState } from "../state/tabsReducer";
import { openContainingFolder, openExternalUrl, openInEditor } from "../lib/commands";
import { isSharePointDocument } from "../lib/sharePoint";

export function ContextMenu({ tab, x, y, onClose, onCloseOthers, onCloseRight, onNewWindow, onError, onDismiss }: { tab: TabState; x: number; y: number; onClose: () => void; onCloseOthers: () => void; onCloseRight: () => void; onNewWindow: () => void; onError: (message: string) => void; onDismiss: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.focus();
    const dismissOnBlur = () => onDismiss();
    window.addEventListener("blur", dismissOnBlur);
    return () => window.removeEventListener("blur", dismissOnBlur);
  }, [onDismiss]);
  const copy = (value: string) => void navigator.clipboard.writeText(value);
  const invoke = (work: Promise<void>) => void work.catch((error) => onError(String(error)));
  const sharePoint = isSharePointDocument(tab.document ?? tab);
  return <div ref={menuRef} className="context-menu" style={{ left: x, top: y }} tabIndex={-1} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDismiss(); }}>
    <button onClick={() => copy(tab.path.split(/[\\/]/).pop() ?? tab.path)}>ファイル名をコピー</button>
    <button onClick={() => copy(tab.path)}>{sharePoint ? "spmd URIをコピー" : "フルパスをコピー"}</button>
    {sharePoint ? <button onClick={() => tab.document?.web_url && invoke(openExternalUrl(tab.document.web_url))} disabled={!tab.document?.web_url}>SharePointで開く</button> : <>
      <button onClick={() => invoke(openContainingFolder(tab.path))}>フォルダを開く</button>
      <button onClick={() => invoke(openInEditor(tab.path, "vscode"))}>VS Code で開く</button>
      <button onClick={() => invoke(openInEditor(tab.path, "notepad"))}>メモ帳で開く</button>
    </>}
    <button onClick={onClose}>タブを閉じる</button>
    <button onClick={onCloseOthers}>他のタブを閉じる</button>
    <button onClick={onCloseRight}>右側のタブを閉じる</button>
    <button onClick={onNewWindow}>別ウィンドウで開く</button>
  </div>;
}
