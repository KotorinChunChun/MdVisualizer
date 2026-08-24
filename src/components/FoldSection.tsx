import { Children, createContext, type ReactElement, type ReactNode, useContext, useEffect, useState } from "react";
import { collapsedForFoldCommand, FOLD_COMMAND_EVENT, type FoldCommand, type FoldCommandName } from "../lib/foldSections";

const FoldHeadingContext = createContext(false);

export function useIsFoldHeading(): boolean {
  return useContext(FoldHeadingContext);
}

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
  const heading = parts[0] as ReactElement<{
    children?: ReactNode;
    className?: string;
    id?: string;
    title?: string;
    "data-block-id"?: string;
    "data-block-fold-id"?: string;
    "data-source-line"?: string | number;
  }> | undefined;
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
      <HeadingTag
        className={heading?.props.className}
        id={heading?.props.id}
        title={heading?.props.title}
        data-block-id={heading?.props["data-block-id"]}
        data-block-fold-id={heading?.props["data-block-fold-id"]}
        data-source-line={heading?.props["data-source-line"]}
      >
        <button
          type="button"
          className="fold-toggle"
          aria-expanded={!collapsed}
          onClick={() => { onManualOverride?.(foldId); setCollapsed(!collapsed); }}
        >
          <span aria-hidden="true" className="fold-chevron">{collapsed ? "▶" : "▼"}</span>
          <span className="fold-heading__content">
            <FoldHeadingContext.Provider value>{heading?.props.children}</FoldHeadingContext.Provider>
          </span>
        </button>
      </HeadingTag>
      <div hidden={collapsed} className="fold-content">{content}</div>
    </section>
  );
}
