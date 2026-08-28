import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ResponsiveToolbarItem {
  id: string;
  node: ReactNode;
  priority?: number;
  fixed?: boolean;
  measurementWidth?: number;
}

export function responsiveOverflowIds(
  availableWidth: number,
  items: Array<Pick<ResponsiveToolbarItem, "id" | "priority" | "fixed"> & { width: number }>,
  gap = 6,
  moreWidth = 38,
): string[] {
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

export function responsiveItemAreaWidth(rootWidth: number, labelWidth: number, hasLabel: boolean, gap = 6): number {
  return Math.max(0, rootWidth - (hasLabel ? labelWidth + gap : 0));
}

export function resolvedResponsiveOverflowIds(
  progressiveIds: string[],
  items: Array<Pick<ResponsiveToolbarItem, "id">>,
  collapseAll: boolean,
): string[] {
  return collapseAll && progressiveIds.length > 0 ? items.map((item) => item.id) : progressiveIds;
}

export function ResponsiveToolbar({ label, ariaLabel, className = "", items, collapseAll = false }: {
  label?: ReactNode;
  ariaLabel: string;
  className?: string;
  items: ResponsiveToolbarItem[];
  collapseAll?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const itemWidths = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  itemsRef.current = items;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      if (root.clientWidth <= 0) return;
      const style = getComputedStyle(root);
      const gap = Number.parseFloat(style.columnGap || style.gap) || 6;
      const labelWidth = labelRef.current?.scrollWidth ?? 0;
      const widths = itemsRef.current.map((item) => {
        const element = itemRefs.current.get(item.id);
        const measured = item.measurementWidth ?? Math.max(element?.scrollWidth ?? 0, element?.offsetWidth ?? 0);
        if (measured > 0) itemWidths.current.set(item.id, measured);
        return {
        ...item,
          width: itemWidths.current.get(item.id) ?? 0,
        };
      });
      const availableWidth = responsiveItemAreaWidth(root.clientWidth, labelWidth, Boolean(label), gap);
      const progressive = responsiveOverflowIds(availableWidth, widths, gap);
      const next = resolvedResponsiveOverflowIds(progressive, itemsRef.current, collapseAll);
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
  });

  useEffect(() => {
    if (overflowIds.length === 0) setMenuOpen(false);
  }, [overflowIds.length]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const updatePosition = () => {
      const bounds = moreButtonRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const right = Math.max(8, window.innerWidth - bounds.right);
      setMenuPosition(bounds.bottom <= window.innerHeight / 2
        ? { top: bounds.bottom + 4, right }
        : { bottom: window.innerHeight - bounds.top + 4, right });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuOpen]);

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
    {label && <div ref={labelRef} className="responsive-toolbar__label">{label}</div>}
    <div className="responsive-toolbar__items">
      {items.map((item) => <div
        key={item.id}
        ref={(element) => { if (element) itemRefs.current.set(item.id, element); else itemRefs.current.delete(item.id); }}
        className={`responsive-toolbar__item${overflow.has(item.id) ? " is-overflowed" : ""}`}
        aria-hidden={overflow.has(item.id) || undefined}
      >{item.node}</div>)}
    </div>
    {overflowIds.length > 0 && <div className="responsive-toolbar__more">
      <button ref={moreButtonRef} type="button" aria-label="その他の操作" aria-expanded={menuOpen} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMenuOpen((open) => !open)}>…</button>
      {menuOpen && menuPosition && createPortal(<div
        className="responsive-toolbar__menu"
        role="menu"
        aria-label={`${ariaLabel}のその他`}
        style={menuPosition}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {items.filter((item) => overflow.has(item.id)).map((item) => <div role="none" key={item.id}>{item.node}</div>)}
      </div>, document.body)}
    </div>}
  </div>;
}
