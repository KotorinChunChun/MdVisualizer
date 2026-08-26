import { useId, useState } from "react";

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

  const removeColumn = (column: number) => {
    if (headers.length <= 1) return;
    setHeaders((current) => current.filter((_, index) => index !== column));
    setRows((current) => current.map((row) => row.filter((_, index) => index !== column)));
    setAlignments((current) => current.filter((_, index) => index !== column));
  };

  const addColumn = () => {
    setHeaders((current) => [...current, `列 ${current.length + 1}`]);
    setRows((current) => current.map((row) => [...row, ""]));
    setAlignments((current) => [...current, null]);
  };

  return <div className="table-editor-overlay">
    <section className="table-editor-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="table-editor-toolbar">
        <strong id={titleId}>表を編集</strong>
        <button type="button" onClick={() => setRows((current) => [...current, headers.map(() => "")])}>行を追加</button>
        <button type="button" onClick={addColumn}>列を追加</button>
      </header>
      <p className="table-editor-note">先頭行はヘッダーです。見出しとセルを編集し、行・列を追加または削除できます。</p>
      <div className="table-editor-scroll">
        <table className="table-editor-grid">
          <thead><tr><th className="table-editor-row-action" aria-label="行操作" />{headers.map((header, column) => <th key={column}>
            <div className="table-editor-heading">
              <input aria-label={`列 ${column + 1}の見出し`} value={header} onChange={(event) => setHeaders((current) => current.map((value, index) => index === column ? event.target.value : value))} />
              <button type="button" aria-label={`列 ${column + 1}を削除`} disabled={headers.length <= 1} onClick={() => removeColumn(column)}>×</button>
            </div>
            {showAlignments && <select aria-label={`列 ${column + 1}の配置`} value={alignments[column] ?? "none"} onChange={(event) => {
              const value = event.target.value === "none" ? null : event.target.value as Exclude<TableColumnAlignment, null>;
              setAlignments((current) => current.map((alignment, index) => index === column ? value : alignment));
            }}>
              <option value="none">既定</option>
              <option value="left">左揃え</option>
              <option value="center">中央揃え</option>
              <option value="right">右揃え</option>
            </select>}
          </th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>
            <td className="table-editor-row-action"><button type="button" aria-label={`行 ${rowIndex + 1}を削除`} onClick={() => setRows((current) => current.filter((_, index) => index !== rowIndex))}>×</button></td>
            {headers.map((_, column) => <td key={column}><textarea aria-label={`行 ${rowIndex + 1} 列 ${column + 1}`} value={row[column] ?? ""} onChange={(event) => setRows((current) => current.map((candidate, index) => index === rowIndex ? headers.map((_, cell) => cell === column ? event.target.value : candidate[cell] ?? "") : candidate))} /></td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <footer className="table-editor-footer">
        <button type="button" onClick={onCancel}>キャンセル</button>
        <button type="button" className="table-editor-save" onClick={() => {
          const accepted = onSave({ headers, rows: rows.map((row) => headers.map((_, column) => row[column] ?? "")), alignments });
          if (accepted !== false) onCancel();
        }}>反映</button>
      </footer>
    </section>
  </div>;
}
