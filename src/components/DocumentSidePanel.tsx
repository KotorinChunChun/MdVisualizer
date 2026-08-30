import { useId, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "../styles/document-side-panel.css";

export type DocumentSidePanelTab = "toc" | "search" | "images";

const PANEL_LABELS: Record<DocumentSidePanelTab, string> = {
  toc: "目次",
  search: "検索",
  images: "画像",
};

export function DocumentSidePanel({
  activeTab,
  onTabChange,
  onClose,
  toc,
  search,
  images,
  disabledTabs = [],
}: {
  activeTab: DocumentSidePanelTab | null;
  onTabChange: (tab: DocumentSidePanelTab | null) => void;
  onClose: () => void;
  toc: ReactNode;
  search: ReactNode;
  images: ReactNode;
  disabledTabs?: DocumentSidePanelTab[];
}) {
  const generatedId = useId().replace(/:/g, "");
  const panelId = `document-side-panel-${generatedId}`;
  const panelRef = useFocusTrap<HTMLElement>(Boolean(activeTab), onClose);
  const content = activeTab === "toc" ? toc : activeTab === "search" ? search : images;

  return <section className={`document-side-panel-root${activeTab ? " is-open" : ""}`} aria-label="文書サイドパネル">
    <nav className="document-side-panel__rail" aria-label="サイドパネルを選択">
      {(Object.keys(PANEL_LABELS) as DocumentSidePanelTab[]).map((tab) => <button
        key={tab}
        type="button"
        aria-controls={panelId}
        aria-expanded={activeTab === tab}
        aria-label={`${PANEL_LABELS[tab]}パネル`}
        disabled={disabledTabs.includes(tab)}
        onClick={() => onTabChange(activeTab === tab ? null : tab)}
      >
        <span aria-hidden="true">{tab === "toc" ? "☰" : tab === "search" ? "⌕" : "▧"}</span>
        <small>{PANEL_LABELS[tab]}</small>
      </button>)}
    </nav>
    {activeTab && <>
      <button type="button" className="document-side-panel__backdrop" aria-label="サイドパネルを閉じる" onClick={onClose} />
      <aside ref={panelRef} id={panelId} className="document-side-panel" role="dialog" aria-modal="true" tabIndex={-1} aria-label={`${PANEL_LABELS[activeTab]}パネルの内容`}>
        <header className="document-side-panel__header">
          <strong>{PANEL_LABELS[activeTab]}</strong>
          <button type="button" aria-label="サイドパネルを閉じる" onClick={onClose}>×</button>
        </header>
        <div className="document-side-panel__content">{content}</div>
      </aside>
    </>}
  </section>;
}
