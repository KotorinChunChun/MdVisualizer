import { Fragment, type CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ResponsiveToolbarItem {
  id: string;
  node: ReactNode;
  compactNode?: ReactNode;
  priority?: number;
  fixed?: boolean;
  measurementWidth?: number;
  group?: "edit" | "copy" | "view" | "storage" | string;
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

export function ResponsiveToolbar({ label, ariaLabel, className = "", items, itemsStyle, itemsClassName = "", collapseAll = false, threeStage = false }: {
  label?: ReactNode;
  ariaLabel: string;
  className?: string;
  items: ResponsiveToolbarItem[];
  itemsStyle?: CSSProperties;
  itemsClassName?: string;
  collapseAll?: boolean;
  threeStage?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const itemWidths = useRef(new Map<string, number>());
  const compactRefs = useRef(new Map<string, HTMLDivElement>());
  const [stage, setStage] = useState<"full" | "compact" | "menu">("full");
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
      const availableWidth = responsiveItemAreaWidth(root.clientWidth, threeStage ? Math.min(labelWidth, root.clientWidth * .25) : labelWidth, Boolean(label), gap);
      if (threeStage) {
        const fullWidth = widths.reduce((sum, item) => sum + item.width, 0) + Math.max(0, widths.length - 1) * gap;
        const essential = itemsRef.current.filter((item) => item.id === "edit" || item.id.startsWith("copy") || item.id === "view");
        const secondary = itemsRef.current.filter((item) => !essential.includes(item)).map((item) => item.id);
        const compactWidth = essential.reduce((sum, item) => sum + (item.compactNode !== undefined ? compactRefs.current.get(item.id)?.scrollWidth ?? 0 : widths.find((value) => value.id === item.id)?.width ?? 0), 0) + Math.max(0, essential.length - 1) * gap + (secondary.length ? 38 + gap : 0);
        const nextStage = fullWidth <= availableWidth ? "full" : compactWidth <= availableWidth ? "compact" : "menu";
        setStage(nextStage);
        const hidden = nextStage === "menu" ? itemsRef.current.map((item) => item.id) : nextStage === "compact" ? secondary : [];
        setOverflowIds((current) => current.length === hidden.length && current.every((id, index) => id === hidden[index]) ? current : hidden);
        return;
      }
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
  return <div ref={rootRef} data-stage={threeStage ? stage : undefined} className={`responsive-toolbar ${className}`.trim()} role="toolbar" aria-label={ariaLabel}>
    {label && <div ref={labelRef} className="responsive-toolbar__label" style={threeStage ? { maxWidth: "25%" } : undefined}>{label}</div>}
    <div className={`responsive-toolbar__items ${itemsClassName}`.trim()} style={itemsStyle}>
      {items.map((item) => <Fragment key={item.id}><div
        key={item.id}
        ref={(element) => { if (element) itemRefs.current.set(item.id, element); else itemRefs.current.delete(item.id); }}
        className={`responsive-toolbar__item${overflow.has(item.id) || (threeStage && stage === "compact" && item.compactNode !== undefined) ? " is-overflowed" : ""}`}
        aria-hidden={overflow.has(item.id) || (threeStage && stage === "compact" && item.compactNode !== undefined) || undefined}
        inert={overflow.has(item.id) || (threeStage && stage === "compact" && item.compactNode !== undefined)}
      >{item.node}</div>{threeStage && item.compactNode !== undefined && <div
        ref={(element) => { if (element) compactRefs.current.set(item.id, element); else compactRefs.current.delete(item.id); }}
        className={`responsive-toolbar__item${stage !== "compact" || overflow.has(item.id) ? " is-overflowed" : ""}`}
        aria-hidden={stage !== "compact" || overflow.has(item.id) || undefined} inert={stage !== "compact" || overflow.has(item.id)}
      >{item.compactNode}</div>}</Fragment>)}
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
        {items.filter((item) => overflow.has(item.id)).map((item, index, overflowItems) => {
          const previous = overflowItems[index - 1];
          const separated = index > 0 && item.group && previous?.group && item.group !== previous.group;
          return <Fragment key={item.id}>
            {separated && <div className="responsive-toolbar__menu-separator" role="separator" />}
            <div role="none" data-group={item.group}>{item.node}</div>
          </Fragment>;
        })}
      </div>, document.body)}
    </div>}
  </div>;
}
