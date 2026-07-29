import { TabState } from "../state/tabsReducer";
import { getFileName } from "../lib/path";

export function TabBar({ tabs, activeId, onActivate, onClose, onMove, onContext }: {
  tabs: TabState[]; activeId: string | null; onActivate: (id: string) => void; onClose: (id: string) => void;
  onMove: (id: string, index: number) => void; onContext: (id: string, x: number, y: number) => void;
}) {
  return <nav className="tab-bar" aria-label="開いているMarkdownファイル">
    {tabs.map((tab, index) => <div key={tab.id} draggable className={`tab ${tab.id === activeId ? "active" : ""}`} title={tab.path} onClick={() => onActivate(tab.id)} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(tab.id); } }} onContextMenu={(event) => { event.preventDefault(); onContext(tab.id, event.clientX, event.clientY); }} onDragStart={(event) => event.dataTransfer.setData("text/plain", tab.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onMove(event.dataTransfer.getData("text/plain"), index); }}>
      <span>{getFileName(tab.path)}</span>
      <button aria-label={`${getFileName(tab.path)} を閉じる`} onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}>×</button>
    </div>)}
  </nav>;
}
