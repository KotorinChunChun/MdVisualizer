import { useId } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface DiagnosticItem {
  severity: "error" | "warning";
  kind: string;
  line: number;
  reference: string;
  message: string;
}

export function DiagnosticsPanel({ items, isOpen, onOpenChange, onSelect }: {
  items: DiagnosticItem[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: DiagnosticItem) => void;
}) {
  const generatedId = useId().replace(/:/g, "");
  const panelId = `diagnostics-panel-${generatedId}`;
  const titleId = `diagnostics-title-${generatedId}`;
  const summaryId = `diagnostics-summary-${generatedId}`;
  const errorCount = items.filter((item) => item.severity === "error").length;
  const warningCount = items.length - errorCount;
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, () => onOpenChange(false));
  return <section className="diagnostics-root" aria-label="文書診断">
    <button type="button" aria-controls={panelId} aria-expanded={isOpen} onClick={() => onOpenChange(!isOpen)}>診断{items.length ? ` (${items.length})` : ""}</button>
    <p className="diagnostics-sr-summary" role="status" aria-live="polite">{items.length === 0 ? "文書診断: 問題はありません" : `文書診断: エラー${errorCount}件、警告${warningCount}件`}</p>
    {isOpen && <div ref={dialogRef} id={panelId} className="diagnostics-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={summaryId} tabIndex={-1}>
      <header><strong id={titleId}>文書診断</strong><button type="button" aria-label="診断を閉じる" onClick={() => onOpenChange(false)}>×</button></header>
      <p id={summaryId} className="diagnostics-panel__summary" role="status" aria-live="polite">{items.length === 0 ? "問題は見つかりませんでした。" : `エラー${errorCount}件、警告${warningCount}件`}</p>
      {items.length > 0 && <ul>{items.map((item, index) => <li key={`${item.line}:${item.kind}:${index}`}>
        <button type="button" className={`diagnostic-${item.severity}`} onClick={() => onSelect(item)}>
          <span>{item.severity === "error" ? "エラー" : "警告"} · {item.kind} · {item.line}行目</span>
          <strong>{item.reference}</strong><small>{item.message}</small>
        </button>
      </li>)}</ul>}
    </div>}
  </section>;
}
