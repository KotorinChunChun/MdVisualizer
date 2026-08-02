import { useId, useMemo } from "react";
import { buildPresentationModel } from "../lib/presentationModel";
import "../styles/document-toc.css";

export interface DocumentTocProps {
  markdown: string;
  isOpen: boolean;
  activeHeadingId?: string;
  onOpenChange: (isOpen: boolean) => void;
  onJump: (headingId: string) => void;
}

/**
 * A normal-layout table of contents.  Visibility and document navigation are
 * intentionally owned by the containing layout, so the same component can be
 * used by every non-presentation view without coupling it to App state.
 */
export function DocumentToc({
  markdown,
  isOpen,
  activeHeadingId,
  onOpenChange,
  onJump,
}: DocumentTocProps) {
  const generatedId = useId();
  const tocId = `document-toc-${generatedId.replace(/:/g, "")}`;
  const model = useMemo(() => buildPresentationModel(markdown), [markdown]);

  const renderItems = (ids: string[]): React.ReactNode => <ul>
    {ids.map((id) => {
      const heading = model.headings[id];
      if (!heading) return null;
      const active = id === activeHeadingId;
      return <li key={id}>
        <button
          type="button"
          aria-current={active ? "location" : undefined}
          title={heading.title}
          onClick={() => onJump(id)}
        >
          {heading.title}
        </button>
        {heading.childIds.length > 0 && renderItems(heading.childIds)}
      </li>;
    })}
  </ul>;

  return <section className={`document-toc-root${isOpen ? " is-open" : ""}`} aria-label="文書目次">
    <button
      type="button"
      className="document-toc-toggle"
      aria-expanded={isOpen}
      aria-controls={tocId}
      onClick={() => onOpenChange(!isOpen)}
    >
      ☰ 目次
    </button>
    {isOpen && <>
      <button type="button" className="document-toc-backdrop" aria-label="目次を閉じる" onClick={() => onOpenChange(false)} />
      <aside id={tocId} className="document-toc" aria-label="文書全体の目次">
        <header className="document-toc__header">
          <strong>目次</strong>
          <button type="button" aria-label="目次を閉じる" onClick={() => onOpenChange(false)}>×</button>
        </header>
        {model.rootIds.length === 0
          ? <p className="document-toc__empty">見出しがありません。</p>
          : <nav aria-label="文書全体の目次">{renderItems(model.rootIds)}</nav>}
      </aside>
    </>}
  </section>;
}
