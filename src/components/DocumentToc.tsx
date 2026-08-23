import { useId, useMemo, useRef, useState } from "react";
import { buildPresentationModel } from "../lib/presentationModel";
import "../styles/document-toc.css";

export interface DocumentTocProps {
  markdown: string;
  isOpen: boolean;
  activeHeadingId?: string;
  onOpenChange: (isOpen: boolean) => void;
  onJump: (headingId: string) => void;
  onMove?: (sourceHeadingId: string, targetHeadingId: string, position: "before" | "after") => boolean | void;
  embedded?: boolean;
}

/**
 * A normal-layout table of contents.  Visibility and document navigation are
 * intentionally owned by the containing layout, so the same component can be
 * used by normal and presentation views without coupling it to App state.
 */
export function DocumentToc({
  markdown,
  isOpen,
  activeHeadingId,
  onOpenChange,
  onJump,
  onMove,
  embedded = false,
}: DocumentTocProps) {
  const generatedId = useId();
  const tocId = `document-toc-${generatedId.replace(/:/g, "")}`;
  const model = useMemo(() => buildPresentationModel(markdown), [markdown]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pointerDragRef = useRef<{
    sourceId: string;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const dropTargetRef = useRef<{ id: string; position: "before" | "after" } | null>(null);
  const suppressClickUntilRef = useRef(0);

  const siblingIds = (id: string): string[] => {
    const heading = model.headings[id];
    if (!heading) return [];
    return heading.parentId ? model.headings[heading.parentId]?.childIds ?? [] : model.rootIds;
  };

  const canMoveTogether = (sourceId: string, targetId: string): boolean => {
    const source = model.headings[sourceId];
    const target = model.headings[targetId];
    return Boolean(source && target && sourceId !== targetId && source.level === target.level && source.parentId === target.parentId);
  };

  const move = (sourceId: string, targetId: string, position: "before" | "after") => {
    if (!onMove || !canMoveTogether(sourceId, targetId)) {
      setAnnouncement("同じ階層の見出し間だけで移動できます。");
      return;
    }
    const moved = onMove(sourceId, targetId, position);
    setAnnouncement(moved === false ? "見出しを移動できませんでした。" : `${model.headings[sourceId].title}を移動しました。`);
  };

  const updateDropTarget = (next: { id: string; position: "before" | "after" } | null) => {
    dropTargetRef.current = next;
    setDropTarget((current) => current?.id === next?.id && current?.position === next?.position ? current : next);
  };

  const resetPointerDrag = () => {
    pointerDragRef.current = null;
    setDraggedId(null);
    updateDropTarget(null);
  };

  const renderItems = (ids: string[]): React.ReactNode => <ul>
    {ids.map((id) => {
      const heading = model.headings[id];
      if (!heading) return null;
      const active = id === activeHeadingId;
      const insertion = dropTarget?.id === id ? dropTarget.position : null;
      return <li key={id} className={`${draggedId === id ? "is-dragging" : ""}${insertion ? ` is-drop-${insertion}` : ""}`}>
        <button
          type="button"
          className={onMove ? "is-movable" : undefined}
          data-toc-heading-id={id}
          aria-current={active ? "location" : undefined}
          title={heading.title}
          onClick={(event) => {
            if (performance.now() < suppressClickUntilRef.current) {
              event.preventDefault();
              return;
            }
            onJump(id);
          }}
          onPointerDown={(event) => {
            if (!onMove || event.button !== 0 || event.isPrimary === false) return;
            pointerDragRef.current = {
              sourceId: id,
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              dragging: false,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = pointerDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (!drag.dragging) {
              if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
              drag.dragging = true;
              setDraggedId(drag.sourceId);
            }
            event.preventDefault();
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-toc-heading-id]");
            const targetId = target?.dataset.tocHeadingId;
            if (!targetId || !canMoveTogether(drag.sourceId, targetId)) {
              updateDropTarget(null);
              return;
            }
            const bounds = target.getBoundingClientRect();
            updateDropTarget({ id: targetId, position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
          }}
          onPointerUp={(event) => {
            const drag = pointerDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            const target = dropTargetRef.current;
            const dragged = drag.dragging;
            resetPointerDrag();
            if (!dragged) return;
            event.preventDefault();
            suppressClickUntilRef.current = performance.now() + 250;
            if (target) move(drag.sourceId, target.id, target.position);
          }}
          onPointerCancel={resetPointerDrag}
          onKeyDown={(event) => {
            if (!onMove || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
            const siblings = siblingIds(id);
            const index = siblings.indexOf(id);
            const targetIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
            const targetId = siblings[targetIndex];
            if (!targetId) return;
            event.preventDefault();
            move(id, targetId, event.key === "ArrowUp" ? "before" : "after");
          }}
        >
          {heading.title}
        </button>
        {heading.childIds.length > 0 && renderItems(heading.childIds)}
      </li>;
    })}
  </ul>;

  const contents = model.rootIds.length === 0
    ? <p className="document-toc__empty">見出しがありません。</p>
    : <nav aria-label="文書全体の目次">{renderItems(model.rootIds)}<p className="document-toc__announcement" aria-live="polite">{announcement}</p></nav>;

  if (embedded) return <div className="document-toc document-toc--embedded">{contents}</div>;

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
        {contents}
      </aside>
    </>}
  </section>;
}
