import { ClipboardEvent, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { calculateTableAggregates, isTableAggregateResultCell } from "../lib/tableAggregation";

export type TableColumnAlignment = "left" | "center" | "right" | null;

export interface EditableTableData {
  headers: string[];
  rows: string[][];
  alignments: TableColumnAlignment[];
}

interface TableEditorDialogProps {
  initialHeaders: string[];
  initialRows: string[][];
  initialAlignments?: TableColumnAlignment[];
  showAlignments?: boolean;
  onCancel: () => void;
  onSave: (table: EditableTableData) => boolean | void;
}

interface GridPoint { row: number; column: number }
interface GridSelection { anchor: GridPoint; focus: GridPoint }
interface TableDragState { axis: "row" | "column"; from: number; over: number }
interface TablePointerDragSession extends TableDragState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const cellKey = ({ row, column }: GridPoint) => `${row}:${column}`;
const orderedSelection = ({ anchor, focus }: GridSelection) => ({
  top: Math.min(anchor.row, focus.row),
  bottom: Math.max(anchor.row, focus.row),
  left: Math.min(anchor.column, focus.column),
  right: Math.max(anchor.column, focus.column),
});

function pastedCells(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const withoutFinalNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return withoutFinalNewline.split("\n").map((line) => line.split("\t"));
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function AlignmentIcon({ direction }: { direction: "left" | "right" }) {
  const widths = direction === "left" ? [14, 10, 14, 8] : [14, 10, 14, 8];
  return <svg aria-hidden="true" viewBox="0 0 18 18" width="16" height="16">
    {widths.map((width, index) => <path key={index} d={`M${direction === "left" ? 2 : 16 - width} ${3 + index * 4}h${width}`} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />)}
  </svg>;
}

export function TableEditorDialog({
  initialHeaders,
  initialRows,
  initialAlignments,
  showAlignments = false,
  onCancel,
  onSave,
}: TableEditorDialogProps) {
  const titleId = useId();
  const [headers, setHeaders] = useState(() => [...initialHeaders]);
  const [rows, setRows] = useState(() => initialRows.map((row) => [...row]));
  const [alignments, setAlignments] = useState<TableColumnAlignment[]>(() => initialHeaders.map((_, index) => initialAlignments?.[index] ?? null));
  const [aggregateMenuOpen, setAggregateMenuOpen] = useState(false);
  const [selection, setSelection] = useState<GridSelection>({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
  const cellRefs = useRef(new Map<string, HTMLInputElement>());
  const dragging = useRef(false);
  const programmaticFocus = useRef<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const pointerDrag = useRef<TablePointerDragSession | null>(null);
  const suppressHandleClick = useRef(false);
  const reorderAnimationTimer = useRef(0);
  const [dragState, setDragState] = useState<TableDragState | null>(null);
  const [reordered, setReordered] = useState<{ axis: "row" | "column"; index: number } | null>(null);
  const calculated = useMemo(() => calculateTableAggregates({ headers, rows }), [headers, rows]);

  const applyChanges = () => {
    const accepted = onSave({ headers, rows: calculated.rows.map((row) => headers.map((_, column) => row[column] ?? "")), alignments });
    if (accepted !== false) onCancel();
  };

  useEffect(() => {
    const finishDragging = () => { dragging.current = false; };
    window.addEventListener("mouseup", finishDragging);
    return () => window.removeEventListener("mouseup", finishDragging);
  }, []);

  useEffect(() => () => window.clearTimeout(reorderAnimationTimer.current), []);

  const focusCell = (point: GridPoint) => {
    programmaticFocus.current = cellKey(point);
    window.requestAnimationFrame(() => {
      const input = cellRefs.current.get(cellKey(point));
      input?.focus();
      input?.select();
      programmaticFocus.current = null;
    });
  };

  const selectCell = (point: GridPoint, extend = false) => {
    setSelection((current) => ({ anchor: extend ? current.anchor : point, focus: point }));
  };

  const selectColumn = (column: number) => {
    setSelection({ anchor: { row: 0, column }, focus: { row: rows.length, column } });
  };

  const selectRow = (row: number) => {
    setSelection({ anchor: { row: row + 1, column: 0 }, focus: { row: row + 1, column: headers.length - 1 } });
  };

  const cellValue = (point: GridPoint) => point.row === 0
    ? headers[point.column] ?? ""
    : calculated.rows[point.row - 1]?.[point.column] ?? "";

  const isCalculatedCell = (point: GridPoint) => point.row > 0
    && isTableAggregateResultCell(calculated, point.row - 1, point.column);

  const updateCell = (point: GridPoint, value: string) => {
    if (point.row === 0) {
      setHeaders((current) => current.map((cell, column) => column === point.column ? value : cell));
      return;
    }
    setRows((current) => current.map((row, rowIndex) => rowIndex === point.row - 1
      ? headers.map((_, column) => column === point.column ? value : row[column] ?? "")
      : row));
  };

  const removeColumn = (column: number) => {
    if (headers.length <= 1) return;
    const hasData = Boolean(headers[column]?.trim()) || rows.some((row) => Boolean(row[column]?.trim()));
    if (hasData && !window.confirm(`「${headers[column] || `列 ${column + 1}`}」列にはデータがあります。削除しますか？`)) return;
    setHeaders((current) => current.filter((_, index) => index !== column));
    setRows((current) => current.map((row) => row.filter((_, index) => index !== column)));
    setAlignments((current) => current.filter((_, index) => index !== column));
    setSelection({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
  };

  const removeRow = (row: number) => {
    const hasData = rows[row]?.some((cell) => Boolean(cell?.trim()));
    if (hasData && !window.confirm(`行 ${row + 1}にはデータがあります。削除しますか？`)) return;
    setRows((current) => current.filter((_, index) => index !== row));
    setSelection({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
  };

  const insertColumn = (column: number, label?: string) => {
    const nextLabel = label ?? `列 ${headers.length + 1}`;
    setHeaders((current) => [...current.slice(0, column), nextLabel, ...current.slice(column)]);
    setRows((current) => current.map((row) => [...row.slice(0, column), "", ...row.slice(column)]));
    setAlignments((current) => [...current.slice(0, column), null, ...current.slice(column)]);
    const point = { row: 0, column };
    setSelection({ anchor: point, focus: point });
    focusCell(point);
  };

  const insertRow = (row: number, label = "") => {
    setRows((current) => [
      ...current.slice(0, row),
      headers.map((_, column) => column === 0 ? label : ""),
      ...current.slice(row),
    ]);
    const point = { row: row + 1, column: 0 };
    setSelection({ anchor: point, focus: point });
    focusCell(point);
  };

  const moveColumn = (from: number, to: number) => {
    if (from === to) return;
    setHeaders((current) => moveItem(current, from, to));
    setRows((current) => current.map((row) => moveItem(row, from, to)));
    setAlignments((current) => moveItem(current, from, to));
    const point = { row: 0, column: to };
    setSelection({ anchor: point, focus: point });
    setReordered({ axis: "column", index: to });
    window.clearTimeout(reorderAnimationTimer.current);
    reorderAnimationTimer.current = window.setTimeout(() => setReordered(null), 360);
  };

  const moveRow = (from: number, to: number) => {
    if (from === to) return;
    setRows((current) => moveItem(current, from, to));
    const point = { row: to + 1, column: 0 };
    setSelection({ anchor: point, focus: point });
    setReordered({ axis: "row", index: to });
    window.clearTimeout(reorderAnimationTimer.current);
    reorderAnimationTimer.current = window.setTimeout(() => setReordered(null), 360);
  };

  const reorderTargetAt = (axis: "row" | "column", clientX: number, clientY: number): number | null => {
    const attribute = axis === "column" ? "data-table-column-index" : "data-table-row-index";
    const pointed = document.elementFromPoint?.(clientX, clientY)?.closest<HTMLElement>(`[${attribute}]`);
    const pointedIndex = Number(pointed?.getAttribute(attribute));
    if (pointed && Number.isInteger(pointedIndex)) return pointedIndex;

    const candidates = dialogRef.current?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [];
    let nearestIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of Array.from(candidates)) {
      const index = Number(candidate.getAttribute(attribute));
      const rect = candidate.getBoundingClientRect();
      const center = axis === "column" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      const distance = Math.abs((axis === "column" ? clientX : clientY) - center);
      if (Number.isInteger(index) && distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    return nearestIndex;
  };

  const beginHandlePointer = (event: ReactPointerEvent<HTMLButtonElement>, axis: "row" | "column", index: number) => {
    if (event.button !== 0) return;
    pointerDrag.current = {
      axis,
      from: index,
      over: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* WebView外のテスト環境では未実装の場合がある。 */ }
  };

  const moveHandlePointer = (event: ReactPointerEvent<HTMLElement>) => {
    const session = pointerDrag.current;
    if (!session || event.pointerId !== session.pointerId) return;
    if (!session.moved && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 5) return;
    event.preventDefault();
    session.moved = true;
    const over = reorderTargetAt(session.axis, event.clientX, event.clientY);
    if (over !== null) session.over = over;
    setDragState({ axis: session.axis, from: session.from, over: session.over });
  };

  const finishHandlePointer = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const session = pointerDrag.current;
    if (!session || event.pointerId !== session.pointerId) return;
    if (!cancelled && session.moved) {
      if (session.axis === "column") moveColumn(session.from, session.over);
      else moveRow(session.from, session.over);
    } else if (!cancelled) {
      if (session.axis === "column") selectColumn(session.from);
      else selectRow(session.from);
    }
    pointerDrag.current = null;
    setDragState(null);
    suppressHandleClick.current = true;
    window.setTimeout(() => { suppressHandleClick.current = false; }, 0);
  };

  const toggleAlignment = (column: number, alignment: "left" | "right") => {
    setAlignments((current) => current.map((value, index) => index === column
      ? value === alignment ? "center" : alignment
      : value));
  };

  const isSelected = (point: GridPoint) => {
    const range = orderedSelection(selection);
    return point.row >= range.top && point.row <= range.bottom && point.column >= range.left && point.column <= range.right;
  };

  const moveSelection = (point: GridPoint, rowDelta: number, columnDelta: number, extend: boolean) => {
    const next = {
      row: Math.max(0, Math.min(rows.length, point.row + rowDelta)),
      column: Math.max(0, Math.min(headers.length - 1, point.column + columnDelta)),
    };
    selectCell(next, extend);
    focusCell(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, point: GridPoint) => {
    const input = event.currentTarget;
    let rowDelta = 0;
    let columnDelta = 0;
    if (event.ctrlKey && event.key.toLocaleLowerCase() === "a") {
      event.preventDefault();
      applyChanges();
      return;
    } else if (event.key === "Enter") rowDelta = event.shiftKey ? -1 : 1;
    else if (event.key === "Tab") columnDelta = event.shiftKey ? -1 : 1;
    else if (event.key === "ArrowUp") rowDelta = -1;
    else if (event.key === "ArrowDown") rowDelta = 1;
    else if (event.key === "ArrowLeft" && input.selectionStart === 0 && input.selectionEnd === 0) columnDelta = -1;
    else if (event.key === "ArrowRight" && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) columnDelta = 1;
    else if ((event.key === "Delete" || event.key === "Backspace") && cellKey(selection.anchor) !== cellKey(selection.focus)) {
      event.preventDefault();
      const range = orderedSelection(selection);
      setHeaders((current) => current.map((value, column) => range.top === 0 && column >= range.left && column <= range.right ? "" : value));
      setRows((current) => current.map((row, rowIndex) => row.map((value, column) => rowIndex + 1 >= Math.max(1, range.top) && rowIndex + 1 <= range.bottom && column >= range.left && column <= range.right ? "" : value)));
      return;
    } else if (event.key === "Escape") {
      selectCell(point);
      return;
    } else return;

    event.preventDefault();
    moveSelection(point, rowDelta, columnDelta, event.shiftKey && event.key !== "Tab");
  };

  const handleCopy = (event: ClipboardEvent<HTMLElement>) => {
    const range = orderedSelection(selection);
    const text = Array.from({ length: range.bottom - range.top + 1 }, (_, rowOffset) =>
      Array.from({ length: range.right - range.left + 1 }, (_, columnOffset) => cellValue({ row: range.top + rowOffset, column: range.left + columnOffset })).join("\t"),
    ).join("\n");
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>, point: GridPoint) => {
    if (isCalculatedCell(point)) return;
    const grid = pastedCells(event.clipboardData.getData("text/plain"));
    if (!grid.length) return;
    event.preventDefault();
    const requiredColumns = Math.max(headers.length, point.column + Math.max(...grid.map((row) => row.length)));
    const requiredBodyRows = Math.max(rows.length, point.row + grid.length - 1);
    const nextHeaders = Array.from({ length: requiredColumns }, (_, column) => headers[column] ?? `列 ${column + 1}`);
    const nextRows = Array.from({ length: requiredBodyRows }, (_, row) => Array.from({ length: requiredColumns }, (_, column) => rows[row]?.[column] ?? ""));
    grid.forEach((pastedRow, rowOffset) => pastedRow.forEach((value, columnOffset) => {
      const destinationRow = point.row + rowOffset;
      const destinationColumn = point.column + columnOffset;
      if (destinationRow === 0) nextHeaders[destinationColumn] = value;
      else nextRows[destinationRow - 1][destinationColumn] = value;
    }));
    setHeaders(nextHeaders);
    setRows(nextRows);
    setAlignments((current) => Array.from({ length: requiredColumns }, (_, column) => current[column] ?? null));
    const focus = {
      row: point.row + grid.length - 1,
      column: point.column + grid[grid.length - 1].length - 1,
    };
    setSelection({ anchor: point, focus });
    focusCell(point);
  };

  const gridInputProps = (point: GridPoint) => ({
    ref: (element: HTMLInputElement | null) => {
      const key = cellKey(point);
      if (element) cellRefs.current.set(key, element);
      else cellRefs.current.delete(key);
    },
    className: isSelected(point) ? "is-selected" : undefined,
    onFocus: () => {
      if (programmaticFocus.current === cellKey(point)) {
        programmaticFocus.current = null;
      } else if (!dragging.current) selectCell(point);
    },
    onMouseDown: (event: MouseEvent<HTMLInputElement>) => {
      dragging.current = true;
      selectCell(point, event.shiftKey);
    },
    onMouseEnter: () => { if (dragging.current) selectCell(point, true); },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => handleKeyDown(event, point),
    onPaste: (event: ClipboardEvent<HTMLInputElement>) => handlePaste(event, point),
  });

  return <div className="table-editor-overlay">
    <section ref={dialogRef} className="table-editor-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onCopy={handleCopy} onPointerMove={moveHandlePointer} onPointerUp={finishHandlePointer} onPointerCancel={(event) => finishHandlePointer(event, true)}>
      <header className="table-editor-toolbar">
        <strong id={titleId}>表を編集</strong>
        <div className="table-editor-aggregate-menu">
          <button type="button" aria-expanded={aggregateMenuOpen} onClick={() => setAggregateMenuOpen((open) => !open)}>集計を追加</button>
          {aggregateMenuOpen && <div role="menu" aria-label="集計を追加">
            {["合計", "平均", "個数"].flatMap((label) => [
              <button key={`${label}行`} type="button" role="menuitem" onClick={() => { insertRow(rows.length, label); setAggregateMenuOpen(false); }}>{label}行</button>,
              <button key={`${label}列`} type="button" role="menuitem" onClick={() => { insertColumn(headers.length, label); setAggregateMenuOpen(false); }}>{label}列</button>,
            ])}
          </div>}
        </div>
      </header>
      <p className="table-editor-note">先頭行はヘッダーです。境界の＋で挿入、ハンドルのドラッグで並び替えできます。Ctrl+Aで編集内容を反映します。</p>
      <div className="table-editor-scroll">
        <table className="table-editor-grid">
          <thead><tr><th className="table-editor-row-action" aria-label="行操作" />{headers.map((header, column) => {
            const point = { row: 0, column };
            const columnClasses = [
              isSelected(point) ? "is-selected" : "",
              dragState?.axis === "column" && dragState.from === column ? "is-dragging" : "",
              dragState?.axis === "column" && dragState.over === column ? "is-drop-target" : "",
              reordered?.axis === "column" && reordered.index === column ? "is-reordered" : "",
            ].filter(Boolean).join(" ");
            return <th key={column} data-table-column-index={column} className={columnClasses || undefined}>
              <button type="button" className="table-editor-insert table-editor-insert-column is-before" aria-label={`列 ${column + 1}の左に挿入`} onClick={() => insertColumn(column)}>＋</button>
              {column === headers.length - 1 && <button type="button" className="table-editor-insert table-editor-insert-column is-after" aria-label={`列 ${column + 1}の右に挿入`} onClick={() => insertColumn(column + 1)}>＋</button>}
              <button type="button" className="table-editor-delete table-editor-delete-column" aria-label={`列 ${column + 1}を削除`} disabled={headers.length <= 1} onClick={() => removeColumn(column)}>−</button>
              <button type="button" className="table-editor-drag-handle table-editor-column-drag-handle" aria-label={`列 ${column + 1}をドラッグして並び替え`} title="ドラッグで列移動、クリックで列選択" onClick={() => { if (!suppressHandleClick.current) selectColumn(column); }} onPointerDown={(event) => beginHandlePointer(event, "column", column)}>•••</button>
              <div className="table-editor-heading">
                {showAlignments && <button
                  type="button"
                  className={`table-editor-alignment-button is-left${alignments[column] === "left" ? " active" : ""}`}
                  aria-label={`列 ${column + 1}を左揃え`}
                  aria-pressed={alignments[column] === "left"}
                  title="左揃え（再度押すと中央揃え）"
                  onClick={() => toggleAlignment(column, "left")}
                ><AlignmentIcon direction="left" /></button>}
                <input {...gridInputProps(point)} aria-label={`列 ${column + 1}の見出し`} value={header} onChange={(event) => updateCell(point, event.target.value)} />
                {showAlignments && <button
                  type="button"
                  className={`table-editor-alignment-button is-right${alignments[column] === "right" ? " active" : ""}`}
                  aria-label={`列 ${column + 1}を右揃え`}
                  aria-pressed={alignments[column] === "right"}
                  title="右揃え（再度押すと中央揃え）"
                  onClick={() => toggleAlignment(column, "right")}
                ><AlignmentIcon direction="right" /></button>}
              </div>
            </th>;
          })}</tr></thead>
          <tbody>{rows.length === 0 ? <tr>
            <td className="table-editor-row-action">
              <button type="button" className="table-editor-insert table-editor-insert-row is-empty" aria-label="最初の行を挿入" onClick={() => insertRow(0)}>＋</button>
            </td>
            <td className="data-grid-empty" colSpan={headers.length}>行はありません</td>
          </tr> : rows.map((_, rowIndex) => <tr key={rowIndex} className={[
            dragState?.axis === "row" && dragState.from === rowIndex ? "is-dragging" : "",
            dragState?.axis === "row" && dragState.over === rowIndex ? "is-drop-target" : "",
            reordered?.axis === "row" && reordered.index === rowIndex ? "is-reordered" : "",
          ].filter(Boolean).join(" ") || undefined} data-table-row-index={rowIndex}>
            <td className="table-editor-row-action">
              <button type="button" className="table-editor-insert table-editor-insert-row is-before" aria-label={`行 ${rowIndex + 1}の上に挿入`} onClick={() => insertRow(rowIndex)}>＋</button>
              {rowIndex === rows.length - 1 && <button type="button" className="table-editor-insert table-editor-insert-row is-after" aria-label={`行 ${rowIndex + 1}の下に挿入`} onClick={() => insertRow(rowIndex + 1)}>＋</button>}
              <button type="button" className="table-editor-delete table-editor-delete-row" aria-label={`行 ${rowIndex + 1}を削除`} onClick={() => removeRow(rowIndex)}>−</button>
              <span className="table-editor-row-buttons">
                <button type="button" className="table-editor-drag-handle" aria-label={`行 ${rowIndex + 1}をドラッグして並び替え`} title="ドラッグで行移動、クリックで行選択" onClick={() => { if (!suppressHandleClick.current) selectRow(rowIndex); }} onPointerDown={(event) => beginHandlePointer(event, "row", rowIndex)}>⋮</button>
              </span>
            </td>
            {headers.map((_, column) => {
              const point = { row: rowIndex + 1, column };
              return <td key={column} className={isSelected(point) ? "is-selected" : undefined}>
                <input {...gridInputProps(point)} aria-label={`行 ${rowIndex + 1} 列 ${column + 1}`} value={cellValue(point)} readOnly={isCalculatedCell(point)} onChange={(event) => updateCell(point, event.target.value)} />
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <footer className="table-editor-footer">
        <button type="button" onClick={onCancel}>キャンセル</button>
        <button type="button" className="table-editor-save" onClick={applyChanges}>反映</button>
      </footer>
    </section>
  </div>;
}
