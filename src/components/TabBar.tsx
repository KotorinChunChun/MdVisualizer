import { TabState } from "../state/tabsReducer";
import { getFileName } from "../lib/path";

export function TabBar({ tabs, activeId, onActivate, onClose }: {
  tabs: TabState[]; activeId: string | null; onActivate: (id: string) => void; onClose: (id: string) => void;
}) {
  return <nav className="tab-bar" aria-label="開いているMarkdownファイル">
    {tabs.map((tab) => <div key={tab.id} className={`tab ${tab.id === activeId ? "active" : ""}`} title={tab.path} onClick={() => onActivate(tab.id)}>
      <span>{getFileName(tab.path)}</span>
      <button aria-label={`${getFileName(tab.path)} を閉じる`} onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}>×</button>
    </div>)}
  </nav>;
}
