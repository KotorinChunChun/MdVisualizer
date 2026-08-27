import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ResponsiveToolbarItem {
  id: string;
  node: ReactNode;
  priority?: number;
  fixed?: boolean;
}

export function responsiveOverflowIds(
  availableWidth: number,
  items: Array<Pick<ResponsiveToolbarItem, "id" | "priority" | "fixed"> & { width: number }>,
  gap = 6,
  moreWidth = 38,
): string[] {
  if (availableWidth <= 0) return [];
  const hidden = new Set<string>();
  const total = () => items.filter((item) => !hidden.has(item.id)).reduce((sum, item) => sum + item.width, 0)
    + Math.max(0, items.length - hidden.size - 1) * gap
    + (hidden.size ? moreWidth + gap : 0);
  const candidates = items.filter((item) => !item.fixed).sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
  for (const item of candidates) {
    if (total() <= availableWidth) break;
    hidden.add(item.id);
  }
  return [...hidden];
}

export function ResponsiveToolbar({ label, ariaLabel, className = "", items }: {
  label?: ReactNode;
  ariaLabel: string;
  className?: string;
  items: ResponsiveToolbarItem[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const availableWidth = root.clientWidth;
      if (availableWidth <= 0) return;
      const widths = items.map((item) => ({
        ...item,
        width: itemRefs.current.get(item.id)?.offsetWidth ?? 0,
      }));
      const next = responsiveOverflowIds(availableWidth, widths);
      setOverflowIds((current) => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = () => setMenuOpen(false);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const overflow = new Set(overflowIds);
  return <div ref={rootRef} className={`responsive-toolbar ${className}`.trim()} role="toolbar" aria-label={ariaLabel}>
    {label && <div className="responsive-toolbar__label">{label}</div>}
    <div className="responsive-toolbar__items">
      {items.map((item) => <div
        key={item.id}
        ref={(element) => { if (element) itemRefs.current.set(item.id, element); else itemRefs.current.delete(item.id); }}
        className={`responsive-toolbar__item${overflow.has(item.id) ? " is-overflowed" : ""}`}
        aria-hidden={overflow.has(item.id) || undefined}
      >{item.node}</div>)}
    </div>
    {overflowIds.length > 0 && <div className="responsive-toolbar__more">
      <button type="button" aria-label="その他の操作" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>…</button>
      {menuOpen && <div role="menu" aria-label={`${ariaLabel}のその他`} onPointerDown={(event) => event.stopPropagation()}>
        {items.filter((item) => overflow.has(item.id)).map((item) => <div role="none" key={item.id}>{item.node}</div>)}
      </div>}
    </div>}
  </div>;
}
