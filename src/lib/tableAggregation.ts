export type TableAggregateKind = "sum" | "average" | "count";

export interface TableAggregationResult {
  headers: string[];
  rows: string[][];
  aggregateRows: Array<TableAggregateKind | null>;
  aggregateColumns: Array<TableAggregateKind | null>;
}

export function tableAggregateKind(value: string): TableAggregateKind | null {
  switch (value.trim()) {
    case "合計": return "sum";
    case "平均": return "average";
    case "個数": return "count";
    default: return null;
  }
}

export function parseTableNumber(value: string): number | null {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function formatTableNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return Number(value.toPrecision(15)).toString();
}

function aggregateValues(kind: TableAggregateKind, values: number[]): string {
  if (kind === "count") return String(values.length);
  if (values.length === 0) return kind === "sum" ? "0" : "";
  const total = values.reduce((sum, value) => sum + value, 0);
  return formatTableNumber(kind === "average" ? total / values.length : total);
}

export function isTableAggregateResultCell(
  result: Pick<TableAggregationResult, "aggregateRows" | "aggregateColumns">,
  row: number,
  column: number,
): boolean {
  const rowKind = result.aggregateRows[row] ?? null;
  const columnKind = result.aggregateColumns[column] ?? null;
  return Boolean(columnKind || (rowKind && column > 0));
}

export function calculateTableAggregates(data: { headers: string[]; rows: string[][] }): TableAggregationResult {
  const width = Math.max(1, data.headers.length, ...data.rows.map((row) => row.length));
  const headers = Array.from({ length: width }, (_, column) => data.headers[column] ?? "");
  const originalRows = data.rows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? ""));
  const aggregateColumns = headers.map(tableAggregateKind);
  const aggregateRows = originalRows.map((row) => tableAggregateKind(row[0] ?? ""));
  const rows = originalRows.map((row) => [...row]);
  const overallValues = originalRows.flatMap((candidate, candidateRow) => aggregateRows[candidateRow]
    ? []
    : candidate.flatMap((value, candidateColumn) => {
      if (aggregateColumns[candidateColumn]) return [];
      const parsed = parseTableNumber(value);
      return parsed === null ? [] : [parsed];
    }));

  for (let row = 0; row < rows.length; row += 1) {
    const rowKind = aggregateRows[row];
    for (let column = 0; column < width; column += 1) {
      const columnKind = aggregateColumns[column];
      if (rowKind && columnKind) {
        rows[row][column] = rowKind === columnKind ? aggregateValues(rowKind, overallValues) : "-";
      } else if (rowKind && column > 0) {
        const values = originalRows.flatMap((candidate, candidateRow) => {
          if (aggregateRows[candidateRow]) return [];
          const value = parseTableNumber(candidate[column] ?? "");
          return value === null ? [] : [value];
        });
        rows[row][column] = aggregateValues(rowKind, values);
      } else if (columnKind) {
        const values = originalRows[row].flatMap((candidate, candidateColumn) => {
          if (aggregateColumns[candidateColumn]) return [];
          const value = parseTableNumber(candidate);
          return value === null ? [] : [value];
        });
        rows[row][column] = aggregateValues(columnKind, values);
      }
    }
  }

  return { headers, rows, aggregateRows, aggregateColumns };
}
