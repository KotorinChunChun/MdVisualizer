import { Children, type ReactElement, type ReactNode, useEffect, useState } from "react";

interface FoldSectionProps {
  children?: ReactNode;
  foldId?: string;
  collapsed?: boolean;
  onCollapsedChange?: (foldId: string, collapsed: boolean) => void;
}

export function FoldSection({ children, foldId = "", collapsed: controlledCollapsed, onCollapsedChange }: FoldSectionProps) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? localCollapsed;
  const setCollapsed = (next: boolean) => { setLocalCollapsed(next); onCollapsedChange?.(foldId, next); };
  const parts = Children.toArray(children);
  const heading = parts[0] as ReactElement<{ children?: ReactNode; className?: string }> | undefined;
  const content = parts[1];
  const HeadingTag = (heading?.type ?? "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<"collapse" | "expand">).detail;
      if (command === "collapse") setCollapsed(true);
      if (command === "expand") setCollapsed(false);
    };
    window.addEventListener("markdown-fold-command", handleCommand);
    return () => window.removeEventListener("markdown-fold-command", handleCommand);
  }, [foldId, onCollapsedChange]);

  return (
    <section className="fold-section">
      <HeadingTag className={heading?.props.className}>
        <button
          type="button"
          className="fold-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <span aria-hidden="true" className="fold-chevron">{collapsed ? "▶" : "▼"}</span>
          {heading?.props.children}
        </button>
      </HeadingTag>
      <div hidden={collapsed} className="fold-content">{content}</div>
    </section>
  );
}
