import { useEffect, useMemo, useState } from "react";
import {
  compareDelimitedValues,
  parseDelimitedTable,
  serializeDelimitedTable,
  type DelimitedTableLanguage,
} from "../lib/delimitedTable";
import { TableEditorDialog } from "./TableEditorDialog";
import { calculateTableAggregates } from "../lib/tableAggregation";
import "../styles/delimited-table.css";

interface DelimitedTableBlockProps {
  language: DelimitedTableLanguage;
  source: string;
  onSave?: (body: string) => boolean | void;
}

type SortState = { column: number; direction: "ascending" | "descending" } | null;

function emitToast(type: "success" | "error", message: string): void {
  window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type, message } }));
}

export function DelimitedTableBlock({ language, source, onSave }: DelimitedTableBlockProps) {
  const parsed = useMemo(() => {
    try { return { data: parseDelimitedTable(source, language), error: null }; }
    catch (error) { return { data: null, error: String(error) }; }
  }, [language, source]);
  const table = useMemo(() => parsed.data
    ? { ...parsed.data, ...calculateTableAggregates(parsed.data) }
    : null, [parsed.data]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [visibleColumns, setVisibleColumns] = useState<boolean[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [panesOpen, setPanesOpen] = useState(false);
  const [selectedValues, setSelectedValues] = useState<Record<number, string[]>>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setQuery("");
    setSort(null);
    setVisibleColumns(table?.headers.map(() => true) ?? []);
    setColumnsOpen(false);
    setPanesOpen(false);
    setSelectedValues({});
    setPage(0);
    setEditing(false);
  }, [language, source, table?.headers.length]);

  const filteredRows = useMemo(() => {
    if (!table) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("ja");
    const filtered = table.rows.filter((row) => {
      if (normalizedQuery && !row.some((cell) => cell.toLocaleLowerCase("ja").includes(normalizedQuery))) return false;
      return Object.entries(selectedValues).every(([column, values]) => values.length === 0 || values.includes(row[Number(column)] ?? ""));
    });
    if (!sort) return filtered;
    return filtered.map((row, index) => ({ row, index })).sort((left, right) => {
      const compared = compareDelimitedValues(left.row[sort.column] ?? "", right.row[sort.column] ?? "");
      return (sort.direction === "ascending" ? compared : -compared) || left.index - right.index;
    }).map(({ row }) => row);
  }, [table, query, selectedValues, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const visibleIndexes = table?.headers.map((_, index) => index).filter((index) => visibleColumns[index] !== false) ?? [];

  useEffect(() => { setPage(0); }, [query, selectedValues, sort, pageSize]);

  if (parsed.error || !parsed.data || !table) return <div className="data-grid-error" role="alert">表を解析できません: {parsed.error}</div>;
  const { headers, rows, delimiter } = table;

  const toggleSort = (column: number) => setSort((current) => current?.column === column
    ? { column, direction: current.direction === "ascending" ? "descending" : "ascending" }
    : { column, direction: "ascending" });
  const clearFilters = () => { setQuery(""); setSelectedValues({}); };
  const exportRows = [visibleIndexes.map((index) => headers[index]), ...filteredRows.map((row) => visibleIndexes.map((index) => row[index] ?? ""))];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportRows.map((row) => row.join("\t")).join("\n"));
      emitToast("success", "表をコピーしました");
    } catch { emitToast("error", "表をコピーできませんでした"); }
  };
  const downloadCsv = () => {
    const body = serializeDelimitedTable({ delimiter: ",", headers: exportRows[0], rows: exportRows.slice(1) });
    const url = URL.createObjectURL(new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "table.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="data-grid-card" aria-label={`${language.toUpperCase()}表`}>
    <div className="data-grid-toolbar">
      <button type="button" aria-pressed={columnsOpen} className={columnsOpen ? "active" : ""} onClick={() => setColumnsOpen((open) => !open)}>列表示</button>
      <button type="button" aria-pressed={panesOpen} className={panesOpen ? "active" : ""} onClick={() => setPanesOpen((open) => !open)}>SearchPanes</button>
      <button type="button" disabled={!query && Object.values(selectedValues).every((values) => values.length === 0)} onClick={clearFilters}>フィルタ解除</button>
      {onSave && <button type="button" onClick={() => setEditing(true)}>表を編集</button>}
      <button type="button" onClick={() => void copy()}>コピー</button>
      <button type="button" onClick={downloadCsv}>CSV</button>
      <button type="button" onClick={() => window.print()}>印刷</button>
      <label className="data-grid-search">検索<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="全列を検索" /></label>
    </div>
    {columnsOpen && <div className="data-grid-column-panel" aria-label="列表示の選択">{headers.map((header, column) => <label key={column}><input type="checkbox" checked={visibleColumns[column] !== false} onChange={(event) => setVisibleColumns((current) => headers.map((_, index) => index === column ? event.target.checked : current[index] !== false))} />{header}</label>)}</div>}
    {panesOpen && <div className="search-panes" aria-label="SearchPanes">{headers.map((header, column) => {
      const counts = new Map<string, number>();
      rows.forEach((row) => counts.set(row[column] ?? "", (counts.get(row[column] ?? "") ?? 0) + 1));
      return <fieldset key={column}><legend>{header}</legend>{[...counts.entries()].sort(([left], [right]) => compareDelimitedValues(left, right)).slice(0, 250).map(([value, count]) => <label key={value}><input type="checkbox" checked={(selectedValues[column] ?? []).includes(value)} onChange={(event) => setSelectedValues((current) => {
        const values = current[column] ?? [];
        return { ...current, [column]: event.target.checked ? [...values, value] : values.filter((candidate) => candidate !== value) };
      })} /><span>{value || "(空白)"}</span><small>{count}</small></label>)}</fieldset>;
    })}</div>}
    <div className="data-grid-table-wrap"><table className="data-grid-table"><thead><tr>{visibleIndexes.map((column) => <th key={column}><button type="button" onClick={() => toggleSort(column)} aria-sort={sort?.column === column ? sort.direction : "none"}>{headers[column]}<span>{sort?.column === column ? sort.direction === "ascending" ? "▲" : "▼" : "◇"}</span></button></th>)}</tr></thead>
      <tbody>{pageRows.length ? pageRows.map((row, rowIndex) => <tr key={`${currentPage}-${rowIndex}`}>{visibleIndexes.map((column) => <td key={column}>{row[column]}</td>)}</tr>) : <tr><td className="data-grid-empty" colSpan={Math.max(1, visibleIndexes.length)}>一致する行はありません</td></tr>}</tbody></table></div>
    <footer className="data-grid-footer"><span>{filteredRows.length} / {rows.length} 行</span><span className="spacer" /><label>表示件数<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={Number.MAX_SAFE_INTEGER}>すべて</option></select></label><button type="button" disabled={currentPage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>前へ</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>次へ</button></footer>
    {editing && <TableEditorDialog initialHeaders={parsed.data.headers} initialRows={parsed.data.rows} onCancel={() => setEditing(false)} onSave={(edited) => onSave?.(serializeDelimitedTable({ delimiter, headers: edited.headers, rows: edited.rows }))} />}
  </section>;
}
