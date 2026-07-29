import { useId, useState } from "react";
import "../styles/image-gallery.css";

export interface ImageGalleryItem {
  path: string;
  src: string;
  filename: string;
  occurrences: {
    id: string;
    caption: string;
    sourceLine: number;
  }[];
}

export function ImageGallery({
  items,
  activeOccurrenceId,
  onJump,
  isOpen: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: {
  items: ImageGalleryItem[];
  activeOccurrenceId?: string;
  onJump: (occurrenceId: string) => void;
  /** Set this with onOpenChange when the containing layout owns panel visibility. */
  isOpen?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}) {
  const generatedId = useId();
  const panelId = `image-gallery-${generatedId.replace(/:/g, "")}`;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const isOpen = controlledOpen ?? uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const toggleItem = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const externallyControlled = controlledOpen !== undefined;
  return <section className={`image-gallery-root${isOpen ? " is-open" : ""}`} aria-label="画像ギャラリー">
    {!externallyControlled && <button
      type="button"
      className="image-gallery-toggle"
      aria-expanded={isOpen}
      aria-controls={panelId}
      onClick={() => setOpen(!isOpen)}
    >
      画像ギャラリー
    </button>}
    {isOpen && <>
      <button type="button" className="image-gallery-backdrop" aria-label="画像ギャラリーを閉じる" onClick={() => setOpen(false)} />
      <aside id={panelId} className="image-gallery" aria-label="画像ギャラリーの一覧">
        <header className="image-gallery__header">
          <strong>画像ギャラリー</strong>
          <button type="button" aria-label="ギャラリーパネルを閉じる" onClick={() => setOpen(false)}>×</button>
        </header>
        {items.length === 0 ? <p className="image-gallery__empty">この文書には画像がありません。</p> : <ul className="image-gallery__list">
          {items.map((item) => {
            const expanded = expandedPaths.has(item.path);
            const itemId = `${panelId}-${item.path}`;
            return <li className="image-gallery-card" key={item.path}>
              <button
                type="button"
                className="image-gallery-card__summary"
                aria-expanded={expanded}
                aria-controls={itemId}
                onClick={() => toggleItem(item.path)}
              >
                <img className="image-gallery-card__thumbnail" src={item.src} alt="" />
                <span className="image-gallery-card__details">
                  <span className="image-gallery-card__filename" title={item.filename}>{item.filename}</span>
                  <span className="image-gallery-card__count">{item.occurrences.length} 箇所</span>
                </span>
                <span className="image-gallery-card__chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
              </button>
              {expanded && <ul id={itemId} className="image-gallery-card__occurrences" aria-label={`${item.filename} の使用箇所`}>
                {item.occurrences.map((occurrence, index) => {
                  const caption = occurrence.caption.trim() || "キャプションなし";
                  const active = occurrence.id === activeOccurrenceId;
                  return <li key={occurrence.id}>
                    <button
                      type="button"
                      aria-current={active ? "location" : undefined}
                      aria-label={`${item.filename} の使用箇所 ${index + 1}: ${caption}（${occurrence.sourceLine}行目）へ移動`}
                      onClick={() => onJump(occurrence.id)}
                    >
                      <span>{caption}</span>
                      <small>{occurrence.sourceLine}行目</small>
                    </button>
                  </li>;
                })}
              </ul>}
            </li>;
          })}
        </ul>}
      </aside>
    </>}
  </section>;
}
