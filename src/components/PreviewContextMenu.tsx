import { useEffect, useRef } from "react";

interface PreviewContextMenuProps {
  x: number;
  y: number;
  plainText: string;
  markdownText: string;
  canEdit: boolean;
  onEdit: () => void;
  onSelectLine: () => void;
  onSelectAll: () => void;
  onResult: (message: string) => void;
  onError: (message: string) => void;
  onDismiss: () => void;
}

export function PreviewContextMenu({ x, y, plainText, markdownText, canEdit, onEdit, onSelectLine, onSelectAll, onResult, onError, onDismiss }: PreviewContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
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
    <button type="button" role="menuitem" disabled={!plainText} onClick={() => copy(plainText, "選択内容")}>コピー</button>
    <button type="button" role="menuitem" disabled={!markdownText} onClick={() => copy(markdownText, "Markdown")}>Markdownでコピー</button>
    <button type="button" role="menuitem" disabled={!canEdit} onClick={() => run(onEdit)}>編集</button>
    <div role="separator" />
    <button type="button" role="menuitem" onClick={() => run(onSelectLine)}>行選択</button>
    <button type="button" role="menuitem" onClick={() => run(onSelectAll)}>すべて選択</button>
  </div>;
}
