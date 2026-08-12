import { Children, type ReactElement, type ReactNode, useEffect, useState } from "react";
import { collapsedForFoldCommand, FOLD_COMMAND_EVENT, type FoldCommand, type FoldCommandName } from "../lib/foldSections";

interface FoldSectionProps {
  children?: ReactNode;
  foldId?: string;
  collapsed?: boolean;
  onCollapsedChange?: (foldId: string, collapsed: boolean) => void;
  forceExpanded?: boolean;
  onManualOverride?: (foldId: string) => void;
}

export function FoldSection({ children, foldId = "", collapsed: controlledCollapsed, onCollapsedChange, forceExpanded = false, onManualOverride }: FoldSectionProps) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = forceExpanded ? false : controlledCollapsed ?? localCollapsed;
  const setCollapsed = (next: boolean) => { setLocalCollapsed(next); onCollapsedChange?.(foldId, next); };
  const parts = Children.toArray(children);
  const heading = parts[0] as ReactElement<{ children?: ReactNode; className?: string }> | undefined;
  const content = parts[1];
  const HeadingTag = (heading?.type ?? "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const headingLevel = Number(HeadingTag.slice(1));

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<FoldCommand | FoldCommandName>).detail;
      const next = collapsedForFoldCommand(detail, headingLevel, foldId);
      if (next !== undefined) setCollapsed(next);
    };
    window.addEventListener(FOLD_COMMAND_EVENT, handleCommand);
    return () => window.removeEventListener(FOLD_COMMAND_EVENT, handleCommand);
  }, [foldId, headingLevel, onCollapsedChange]);

  return (
    <section className="fold-section" data-fold-id={foldId} data-fold-level={headingLevel}>
      <HeadingTag className={heading?.props.className}>
        <button
          type="button"
          className="fold-toggle"
          aria-expanded={!collapsed}
          onClick={() => { onManualOverride?.(foldId); setCollapsed(!collapsed); }}
        >
          <span aria-hidden="true" className="fold-chevron">{collapsed ? "▶" : "▼"}</span>
          {heading?.props.children}
        </button>
      </HeadingTag>
      <div hidden={collapsed} className="fold-content">{content}</div>
    </section>
  );
}
