import { BlockCopyMenu } from "./BlockCopyMenu";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  compareDelimitedValues,
  parseDelimitedTable,
  serializeDelimitedTable,
  type DelimitedTableLanguage,
} from "../lib/delimitedTable";
import { TableEditorDialog } from "./TableEditorDialog";
import { calculateTableAggregates } from "../lib/tableAggregation";
import { copyTextFile } from "../lib/commands";
import { ResponsiveToolbar } from "./ResponsiveToolbar";
import { executePrintSession, type PrintDevice } from "../lib/printSession";
import "../styles/delimited-table.css";

interface DelimitedTableBlockProps {
  language: DelimitedTableLanguage;
  source: string;
  onSave?: (body: string) => boolean | void | Promise<boolean | void>;
  headingLabel?: ReactNode;
  storage?: "embedded" | "external";
  onStorageConvert?: () => boolean | void | Promise<boolean | void>;
  printDevice?: PrintDevice;
}

type SortCriterion = { column: number; direction: "ascending" | "descending" };
type TableContextMenu = { kind: "column"; column: number; x: number; y: number } | { kind: "row"; row: string[]; x: number; y: number } | null;

function emitToast(type: "success" | "error" | "info", message: string, actions?: Array<{ label: string; onAction: () => void | Promise<void> }>): void {
  window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type, message, actions } }));
}

export function DelimitedTableBlock({ language, source, onSave, headingLabel, storage, onStorageConvert, printDevice }: DelimitedTableBlockProps) {
  const parsed = useMemo(() => {
    try { return { data: parseDelimitedTable(source, language), error: null }; }
    catch (error) { return { data: null, error: String(error) }; }
  }, [language, source]);
  const table = useMemo(() => parsed.data
    ? { ...parsed.data, ...calculateTableAggregates(parsed.data) }
    : null, [parsed.data]);
  const [query, setQuery] = useState("");
  const [display, setDisplay] = useState("preview");
  const [sort, setSort] = useState<SortCriterion[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<boolean[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [panesOpen, setPanesOpen] = useState(false);
  const [selectedValues, setSelectedValues] = useState<Record<number, string[]>>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState(false);
  const [contextMenu, setContextMenu] = useState<TableContextMenu>(null);
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState<string[] | null>(null);
  const [convertingStorage, setConvertingStorage] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setQuery("");
    setSort([]);
    setVisibleColumns(table?.headers.map(() => true) ?? []);
    setColumnsOpen(false);
    setPanesOpen(false);
    setSelectedValues({});
    setPage(0);
    setEditing(false);
    setContextMenu(null);
    setSelectedColumn(null);
    setSelectedRow(null);
  }, [language, source, table?.headers.length]);

  const filteredRows = useMemo(() => {
    if (!table) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("ja");
    const filtered = table.rows.filter((row) => {
      if (normalizedQuery && !row.some((cell) => cell.toLocaleLowerCase("ja").includes(normalizedQuery))) return false;
      return Object.entries(selectedValues).every(([column, values]) => values.length === 0 || values.includes(row[Number(column)] ?? ""));
    });
    if (sort.length === 0) return filtered;
    return filtered.map((row, index) => ({ row, index })).sort((left, right) => {
      for (const criterion of sort) {
        const compared = compareDelimitedValues(left.row[criterion.column] ?? "", right.row[criterion.column] ?? "");
        if (compared) return criterion.direction === "ascending" ? compared : -compared;
      }
      return left.index - right.index;
    }).map(({ row }) => row);
  }, [table, query, selectedValues, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const visibleIndexes = table?.headers.map((_, index) => index).filter((index) => visibleColumns[index] !== false) ?? [];

  useEffect(() => { setPage(0); }, [query, selectedValues, sort, pageSize]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  if (parsed.error || !parsed.data || !table) return <div className="data-grid-error" role="alert">表を解析できません: {parsed.error}</div>;
  const { headers, rows, delimiter } = table;

  const toggleSort = (column: number) => setSort((current) => {
    const existing = current.find((criterion) => criterion.column === column);
    const remaining = current.filter((criterion) => criterion.column !== column);
    if (!existing) return [{ column, direction: "ascending" }, ...remaining];
    if (existing.direction === "ascending") return [{ column, direction: "descending" }, ...remaining];
    return remaining;
  });
  const clearColumnFilter = (column: number) => setSelectedValues((current) => {
    if (!(column in current)) return current;
    const next = { ...current };
    delete next[column];
    return next;
  });
  const exportRows = [visibleIndexes.map((index) => headers[index]), ...filteredRows.map((row) => visibleIndexes.map((index) => row[index] ?? ""))];

  const serialized = (format: "csv" | "tsv") => serializeDelimitedTable({
    delimiter: format === "csv" ? "," : "\t",
    headers: exportRows[0],
    rows: exportRows.slice(1),
  });
  const copyTableFile = async (format: "csv" | "tsv") => {
    try {
      await copyTextFile({ filename: `table.${format}`, content: serialized(format), utf8Bom: format === "csv" });
      emitToast("success", `${format.toUpperCase()}ファイルをコピーしました`);
    } catch { emitToast("error", `${format.toUpperCase()}ファイルをコピーできませんでした`); }
  };
  const copy = async (format: "csv" | "tsv") => {
    try {
      await navigator.clipboard.writeText(serialized(format));
      emitToast("success", `${format.toUpperCase()}で表をコピーしました`, [
        { label: "ファイルとしてコピー", onAction: () => copyTableFile(format) },
      ]);
    } catch { emitToast("error", `${format.toUpperCase()}で表をコピーできませんでした`); }
  };

  const printTable = () => {
    if (document.body.classList.contains("table-print-active")) return;
    const host = document.createElement("div");
    host.className = "table-print-host";
    const printTableElement = document.createElement("table");
    printTableElement.className = "data-grid-table";
    const head = printTableElement.createTHead().insertRow();
    visibleIndexes.forEach((column) => {
      const cell = document.createElement("th");
      cell.textContent = headers[column];
      head.append(cell);
    });
    const body = printTableElement.createTBody();
    filteredRows.forEach((row) => {
      const printRow = body.insertRow();
      visibleIndexes.forEach((column) => {
        const cell = printRow.insertCell();
        cell.textContent = row[column] ?? "";
      });
    });
    host.append(printTableElement);
    document.body.append(host);
    document.body.classList.add("table-print-active");
    const cleanupPrint = () => {
      document.body.classList.remove("table-print-active");
      host.remove();
    };
    void executePrintSession({ print: printDevice, restore: cleanupPrint })
      .catch((error) => emitToast("error", `表を印刷できません: ${String(error)}`));
  };

  const copyText = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      emitToast("success", success);
    } catch { emitToast("error", "コピーできませんでした"); }
  };
  const selectBlock = () => {
    if (!cardRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(cardRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  return <section ref={cardRef} className="data-grid-card" aria-label={`${language.toUpperCase()}表`}>
    <ResponsiveToolbar threeStage label={headingLabel ?? <strong className="data-grid-kind">{language.toUpperCase()}{storage && <span className="content-storage-status">{storage === "embedded" ? "埋め込み" : "外部参照"}</span>}</strong>} className="data-grid-toolbar" ariaLabel="表操作" itemsStyle={{ width: "auto", flexGrow: 1, flexShrink: 1, flexBasis: 0 }} items={[
      { id: "search", priority: 120, fixed: true, measurementWidth: 180, node: <label className="data-grid-search"><input aria-label="検索キーワードを入力" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="検索キーワードを入力" /></label> },
      { id: "columns", priority: 20, node: <button type="button" aria-pressed={columnsOpen} className={columnsOpen ? "active" : ""} onClick={() => setColumnsOpen((open) => !open)}>列表示</button> },
      { id: "slicer", priority: 25, node: <button type="button" aria-pressed={panesOpen} className={panesOpen ? "active" : ""} onClick={() => setPanesOpen((open) => !open)}>スライサー</button> },
      ...(onSave ? [{ id: "edit", priority: 110, node: <button type="button" onClick={() => setEditing(true)}>表を編集</button> }] : []),
      { id: "view", node: <><button type="button" aria-pressed={display === "preview"} onClick={() => setDisplay("preview")}>プレビュー</button><button type="button" aria-pressed={display === "code"} onClick={() => setDisplay("code")}>コード</button></>, compactNode: <select aria-label="表の表示内容" value={display} onChange={(event) => setDisplay(event.target.value)}><option value="preview">プレビュー</option><option value="code">コード</option></select> },
      { id: "copy", priority: 100, compactNode: <BlockCopyMenu><button type="button" onClick={() => void copy("csv")}>CSVコピー</button><button type="button" onClick={() => void copy("tsv")}>TSVコピー</button></BlockCopyMenu>, node: <><button type="button" onClick={() => void copy("csv")}>CSVコピー</button><button type="button" onClick={() => void copy("tsv")}>TSVコピー</button></> },
      { id: "print", priority: 15, node: <button type="button" onClick={printTable}>印刷</button> },
      ...(storage && onStorageConvert ? [{ id: "storage", priority: 90, node: <button type="button" disabled={convertingStorage} onClick={() => {
        setConvertingStorage(true);
        void Promise.resolve().then(onStorageConvert).catch((error) => emitToast("error", error instanceof Error ? error.message : String(error))).finally(() => setConvertingStorage(false));
      }}>{convertingStorage ? "切替中…" : storage === "embedded" ? "外部ファイルへ切替" : "埋め込みへ切替"}</button> }] : []),
    ]} />
    {columnsOpen && <div className="data-grid-column-panel" aria-label="列表示の選択">{headers.map((header, column) => <label key={column}><input type="checkbox" checked={visibleColumns[column] !== false} onChange={(event) => setVisibleColumns((current) => headers.map((_, index) => index === column ? event.target.checked : current[index] !== false))} />{header}</label>)}</div>}
    {panesOpen && <div className="search-panes" aria-label="スライサー">{headers.map((header, column) => {
      const counts = new Map<string, number>();
      rows.forEach((row) => counts.set(row[column] ?? "", (counts.get(row[column] ?? "") ?? 0) + 1));
      const columnValues = selectedValues[column] ?? [];
      return <fieldset key={column}><legend>{header}<button type="button" className="search-panes__clear" disabled={columnValues.length === 0} onClick={() => clearColumnFilter(column)}>フィルタ解除</button></legend>{[...counts.entries()].sort(([left], [right]) => compareDelimitedValues(left, right)).slice(0, 250).map(([value, count]) => <label key={value}><input type="checkbox" checked={columnValues.includes(value)} onChange={(event) => setSelectedValues((current) => {
        const values = current[column] ?? [];
        return { ...current, [column]: event.target.checked ? [...values, value] : values.filter((candidate) => candidate !== value) };
      })} /><span>{value || "(空白)"}</span><small>{count}</small></label>)}</fieldset>;
    })}</div>}
    {display === "code" && <pre aria-label="表のコード"><code>{source}</code></pre>}
    <div className="data-grid-table-wrap" style={display === "code" ? { display: "none" } : undefined}><table className="data-grid-table"><thead><tr>{visibleIndexes.map((column) => {
      const priority = sort.findIndex((criterion) => criterion.column === column);
      const criterion = priority >= 0 ? sort[priority] : null;
      const sortLabel = criterion ? `${criterion.direction === "ascending" ? "昇順" : "降順"}、優先順位${priority + 1}` : "ソートなし";
      return <th key={column} className={selectedColumn === column ? "is-selected-column" : undefined} aria-sort={criterion?.direction ?? "none"} onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ kind: "column", column, x: event.clientX, y: event.clientY });
      }}><button type="button" onClick={() => toggleSort(column)} aria-label={`${headers[column]}: ${sortLabel}`}>{headers[column]}<span>{criterion ? `${criterion.direction === "ascending" ? "▲" : "▼"}${priority + 1}` : "◇"}</span></button></th>;
    })}</tr></thead>
      <tbody>{pageRows.length ? pageRows.map((row, rowIndex) => <tr key={`${currentPage}-${rowIndex}`} className={selectedRow === row ? "is-selected-row" : undefined} onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ kind: "row", row, x: event.clientX, y: event.clientY });
      }}>{visibleIndexes.map((column) => <td key={column} className={selectedColumn === column ? "is-selected-column" : undefined}>{row[column]}</td>)}</tr>) : <tr><td className="data-grid-empty" colSpan={Math.max(1, visibleIndexes.length)}>一致する行はありません</td></tr>}</tbody></table></div>
    <footer className="data-grid-footer"><span>{filteredRows.length} / {rows.length} 行</span><span className="spacer" /><label>表示件数<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={Number.MAX_SAFE_INTEGER}>すべて</option></select></label><button type="button" disabled={currentPage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>前へ</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>次へ</button></footer>
    {contextMenu && <div className="context-menu data-grid-context-menu" role="menu" aria-label={contextMenu.kind === "column" ? "列操作" : "行操作"} style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {contextMenu.kind === "column" ? <>
        <button type="button" role="menuitem" disabled={visibleIndexes.length <= 1} onClick={() => {
          setVisibleColumns((current) => headers.map((_, index) => index === contextMenu.column ? false : current[index] !== false));
          setContextMenu(null);
        }}>列の非表示</button>
        <button type="button" role="menuitem" onClick={() => { setSelectedColumn(contextMenu.column); setSelectedRow(null); setContextMenu(null); }}>列全体の選択</button>
        <button type="button" role="menuitem" onClick={() => {
          setSelectedColumn(contextMenu.column);
          setSelectedRow(null);
          void copyText(serializeDelimitedTable({
            delimiter: "\t",
            headers: [headers[contextMenu.column]],
            rows: filteredRows.map((row) => [row[contextMenu.column] ?? ""]),
          }), "列をコピーしました");
          setContextMenu(null);
        }}>選択した列のコピー</button>
      </> : <>
        <button type="button" role="menuitem" onClick={() => { setSelectedRow(contextMenu.row); setSelectedColumn(null); setContextMenu(null); }}>行選択</button>
        <button type="button" role="menuitem" onClick={() => {
          setSelectedRow(contextMenu.row);
          setSelectedColumn(null);
          void copyText(serializeDelimitedTable({
            delimiter: "\t",
            headers: visibleIndexes.map((column) => contextMenu.row[column] ?? ""),
            rows: [],
          }), "行をコピーしました");
          setContextMenu(null);
        }}>選択した行をTSVでコピー</button>
        <button type="button" role="menuitem" onClick={() => { selectBlock(); setContextMenu(null); }}>ブロック全体を選択</button>
      </>}
    </div>}
    {editing && <TableEditorDialog initialHeaders={parsed.data.headers} initialRows={parsed.data.rows} onCancel={() => setEditing(false)} onSave={(edited) => onSave?.(serializeDelimitedTable({ delimiter, headers: edited.headers, rows: edited.rows }))} />}
  </section>;
}
