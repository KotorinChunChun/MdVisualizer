import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface PreviewContextMenuProps {
  x: number;
  y: number;
  plainText: string;
  markdownText: string;
  rowTsv?: string;
  canEdit: boolean;
  onEdit: () => void;
  onAddBlockAfter?: () => void;
  onSelectLine: () => void;
  onSelectRow?: () => void;
  onSelectAll: () => void;
  onResult: (message: string) => void;
  onError: (message: string) => void;
  onDismiss: () => void;
}

export function PreviewContextMenu({ x, y, plainText, markdownText, rowTsv, canEdit, onEdit, onAddBlockAfter, onSelectLine, onSelectRow, onSelectAll, onResult, onError, onDismiss }: PreviewContextMenuProps) {
  const menuRef = useFocusTrap<HTMLDivElement>(true, onDismiss);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  const copy = (value: string, label: string) => {
    onDismiss();
    void navigator.clipboard.writeText(value)
      .then(() => onResult(`${label}をコピーしました`))
      .catch((error) => onError(String(error)));
  };
  const run = (operation: () => void) => {
    onDismiss();
    operation();
  };

  return <div
    ref={menuRef}
    className="context-menu preview-context-menu"
    role="menu"
    aria-label="View操作"
    style={{ left: x, top: y }}
    tabIndex={-1}
  >
    <button type="button" role="menuitem" disabled={!markdownText} onClick={() => copy(markdownText, "Markdown")}>コードをMarkdownでコピー</button>
    <button type="button" role="menuitem" disabled={!plainText} onClick={() => copy(plainText, "表示内容")}>プレーンテキストでコピー</button>
    <button type="button" role="menuitem" disabled={!canEdit} onClick={() => run(onEdit)}>編集</button>
    {onAddBlockAfter && <button type="button" role="menuitem" disabled={!canEdit} onClick={() => run(onAddBlockAfter)}>下にブロックを追加</button>}
    <div role="separator" />
    <button type="button" role="menuitem" onClick={() => run(onSelectRow ?? onSelectLine)}>行選択</button>
    {onSelectRow && <button type="button" role="menuitem" disabled={!rowTsv} onClick={() => copy(rowTsv ?? "", "行")}>選択した行をTSVでコピー</button>}
    <button type="button" role="menuitem" onClick={() => run(onSelectLine)}>ブロック全体を選択</button>
    <button type="button" role="menuitem" onClick={() => run(onSelectAll)}>すべて選択</button>
  </div>;
}
