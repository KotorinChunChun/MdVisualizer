import { TabState } from "../state/tabsReducer";

export function ContextMenu({ tab, x, y, onClose, onCloseOthers, onCloseRight, onNewWindow }: { tab: TabState; x: number; y: number; onClose: () => void; onCloseOthers: () => void; onCloseRight: () => void; onNewWindow: () => void }) {
  const copy = (value: string) => void navigator.clipboard.writeText(value);
  return <div className="context-menu" style={{ left: x, top: y }}>
    <button onClick={() => copy(tab.path.split(/[\\/]/).pop() ?? tab.path)}>ファイル名をコピー</button>
    <button onClick={() => copy(tab.path)}>フルパスをコピー</button>
    <button onClick={onClose}>タブを閉じる</button>
    <button onClick={onCloseOthers}>他のタブを閉じる</button>
    <button onClick={onCloseRight}>右側のタブを閉じる</button>
    <button onClick={onNewWindow}>別ウィンドウで開く</button>
  </div>;
}
