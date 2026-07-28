import { Children, type ReactElement, type ReactNode, useState } from "react";

interface FoldSectionProps {
  children?: ReactNode;
}

export function FoldSection({ children }: FoldSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const parts = Children.toArray(children);
  const heading = parts[0] as ReactElement<{ children?: ReactNode; className?: string }> | undefined;
  const content = parts[1];
  const HeadingTag = (heading?.type ?? "h2") as "h1" | "h2" | "h3" | "h4";

  return (
    <section className="fold-section">
      <HeadingTag className={heading?.props.className}>
        <button
          type="button"
          className="fold-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span aria-hidden="true" className="fold-chevron">{collapsed ? "▶" : "▼"}</span>
          {heading?.props.children}
        </button>
      </HeadingTag>
      <div hidden={collapsed} className="fold-content">{content}</div>
    </section>
  );
}
