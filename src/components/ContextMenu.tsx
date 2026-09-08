import { useEffect } from "react";
import { TabState } from "../state/tabsReducer";
import { openContainingFolder, openExternalUrl, openInEditor } from "../lib/commands";
import { isSharePointDocument, sharePointLibraryViewUrl } from "../lib/sharePoint";
import { stripWindowsExtendedPathPrefix } from "../lib/path";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function ContextMenu({ tab, x, y, onClose, onCloseOthers, onCloseRight, onRename, onNewWindow, onResult, onError, onDismiss }: { tab: TabState; x: number; y: number; onClose: () => void; onCloseOthers: () => void; onCloseRight: () => void; onRename?: () => void | Promise<void>; onNewWindow?: () => void | Promise<void>; onResult: (message: string) => void; onError: (message: string) => void; onDismiss: () => void }) {
  const menuRef = useFocusTrap<HTMLDivElement>(true, onDismiss);
  useEffect(() => {
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
  const renameDisabled = untitled || sharePoint || Boolean(tab.dirty || tab.saving || tab.deleted || !onRename);
  return <div ref={menuRef} className="context-menu" role="menu" aria-label="タブ操作" style={{ left: x, top: y }} tabIndex={-1} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDismiss(); }}>
    <button type="button" role="menuitem" disabled={renameDisabled} title={tab.dirty || tab.saving ? "未保存の編集を保存してから名前を変更できます" : undefined} onClick={() => onRename && run("ファイル名を変更しました", onRename)}>ファイル名を変更</button>
    <button type="button" role="menuitem" onClick={() => copy(tab.path.split(/[\\/]/).pop() ?? tab.path, "ファイル名")}>ファイル名をコピー</button>
    <button type="button" role="menuitem" onClick={() => copy(sharePoint ? tab.path : stripWindowsExtendedPathPrefix(tab.path), sharePoint ? "spmd URI" : "フルパス")}>{sharePoint ? "spmd URIをコピー" : "フルパスをコピー"}</button>
    {sharePoint ? <button type="button" role="menuitem" onClick={() => sharePointUrl && run("SharePointをブラウザーで開きました", () => openExternalUrl(sharePointUrl))} disabled={!sharePointUrl}>SharePointで開く</button> : <>
      <button type="button" role="menuitem" disabled={untitled} onClick={() => run("フォルダーを開きました", () => openContainingFolder(tab.path))}>フォルダを開く</button>
      <button type="button" role="menuitem" disabled={untitled} onClick={() => run("VS Codeで開きました", () => openInEditor(tab.path, "vscode"))}>VS Code で開く</button>
      <button type="button" role="menuitem" disabled={untitled} onClick={() => run("メモ帳で開きました", () => openInEditor(tab.path, "notepad"))}>メモ帳で開く</button>
    </>}
    <button type="button" role="menuitem" onClick={() => run("タブを閉じました", onClose)}>タブを閉じる</button>
    <button type="button" role="menuitem" onClick={() => run("他のタブを閉じました", onCloseOthers)}>他のタブを閉じる</button>
    <button type="button" role="menuitem" onClick={() => run("右側のタブを閉じました", onCloseRight)}>右側のタブを閉じる</button>
    <button type="button" role="menuitem" disabled={!onNewWindow} onClick={() => onNewWindow && run("別ウィンドウで開きました", onNewWindow)}>別ウィンドウで開く</button>
  </div>;
}
