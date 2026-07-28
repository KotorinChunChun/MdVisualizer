import { TabState } from "../state/tabsReducer";
import { openContainingFolder, openInEditor } from "../lib/commands";

export function ContextMenu({ tab, x, y, onClose, onCloseOthers, onCloseRight, onNewWindow, onError }: { tab: TabState; x: number; y: number; onClose: () => void; onCloseOthers: () => void; onCloseRight: () => void; onNewWindow: () => void; onError: (message: string) => void }) {
  const copy = (value: string) => void navigator.clipboard.writeText(value);
  const invoke = (work: Promise<void>) => void work.catch((error) => onError(String(error)));
  return <div className="context-menu" style={{ left: x, top: y }}>
    <button onClick={() => copy(tab.path.split(/[\\/]/).pop() ?? tab.path)}>ファイル名をコピー</button>
    <button onClick={() => copy(tab.path)}>フルパスをコピー</button>
    <button onClick={() => invoke(openContainingFolder(tab.path))}>フォルダを開く</button>
    <button onClick={() => invoke(openInEditor(tab.path, "vscode"))}>VS Code で開く</button>
    <button onClick={() => invoke(openInEditor(tab.path, "notepad"))}>メモ帳で開く</button>
    <button onClick={onClose}>タブを閉じる</button>
    <button onClick={onCloseOthers}>他のタブを閉じる</button>
    <button onClick={onCloseRight}>右側のタブを閉じる</button>
    <button onClick={onNewWindow}>別ウィンドウで開く</button>
  </div>;
}
