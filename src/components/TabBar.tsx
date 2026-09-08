import { TabState } from "../state/tabsReducer";
import { getFileName } from "../lib/path";

export function TabBar({ tabs, activeId, onActivate, onClose, onMove, onContext }: {
  tabs: TabState[]; activeId: string | null; onActivate: (id: string) => void; onClose: (id: string) => void;
  onMove: (id: string, index: number) => void; onContext: (id: string, x: number, y: number) => void;
}) {
  const labelFor = (tab: TabState) => tab.kind === "settings" ? "設定" : getFileName(tab.path);
  return <nav className="tab-bar" aria-label="開いているMarkdownファイル">
    {tabs.map((tab, index) => <div key={tab.id} draggable className={`tab ${tab.id === activeId ? "active" : ""}${tab.deleted ? " is-deleted" : ""}`} title={tab.deleted ? `${tab.path}（削除済み）` : tab.kind === "settings" ? labelFor(tab) : tab.path} onClick={() => onActivate(tab.id)} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(tab.id); } }} onContextMenu={(event) => { event.preventDefault(); if (tab.kind !== "settings") onContext(tab.id, event.clientX, event.clientY); }} onDragStart={(event) => event.dataTransfer.setData("text/plain", tab.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onMove(event.dataTransfer.getData("text/plain"), index); }}>
      <span className="tab__label">{tab.kind === "settings" ? "⚙ 設定" : <>{labelFor(tab)}{tab.deleted ? <span className="tab__deleted-label">（削除済み）</span> : tab.dirty ? " *" : ""}</>}</span>
      <button aria-label={`${labelFor(tab)} を閉じる`} onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}>×</button>
    </div>)}
  </nav>;
}
