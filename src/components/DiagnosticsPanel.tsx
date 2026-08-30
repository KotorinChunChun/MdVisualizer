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
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, () => onOpenChange(false));
  return <section className="diagnostics-root" aria-label="文書診断">
    <button type="button" aria-expanded={isOpen} onClick={() => onOpenChange(!isOpen)}>診断{items.length ? ` (${items.length})` : ""}</button>
    {isOpen && <div ref={dialogRef} className="diagnostics-panel" role="dialog" aria-modal="true" aria-label="文書診断結果" tabIndex={-1}>
      <header><strong>文書診断</strong><button type="button" aria-label="診断を閉じる" onClick={() => onOpenChange(false)}>×</button></header>
      {items.length === 0 ? <p>問題は見つかりませんでした。</p> : <ul>{items.map((item, index) => <li key={`${item.line}:${item.kind}:${index}`}>
        <button type="button" className={`diagnostic-${item.severity}`} onClick={() => onSelect(item)}>
          <span>{item.severity === "error" ? "エラー" : "警告"} · {item.kind} · {item.line}行目</span>
          <strong>{item.reference}</strong><small>{item.message}</small>
        </button>
      </li>)}</ul>}
    </div>}
  </section>;
}
