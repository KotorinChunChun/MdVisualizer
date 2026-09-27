export type TableSortDirection = "ascending" | "descending";
export type TableSortCriterion = { column: number; direction: TableSortDirection };

/** 表の列ソートを未指定→昇順→降順→未指定で切り替え、多段の優先順位を保つ。 */
export function toggleTableSort(current: readonly TableSortCriterion[], column: number): TableSortCriterion[] {
  const existing = current.find((criterion) => criterion.column === column);
  const remaining = current.filter((criterion) => criterion.column !== column);
  if (!existing) return [{ column, direction: "ascending" }, ...remaining];
  if (existing.direction === "ascending") return [{ column, direction: "descending" }, ...remaining];
  return remaining;
}

/** フィルター後の行を安定ソートする。比較結果が同じ行は元の順序を保つ。 */
export function sortTableRows<T>(rows: readonly T[], sort: readonly TableSortCriterion[], valueAt: (row: T, column: number) => string, compare: (left: string, right: string) => number): T[] {
  if (sort.length === 0) return [...rows];
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    for (const criterion of sort) {
      const compared = compare(valueAt(left.row, criterion.column), valueAt(right.row, criterion.column));
      if (compared !== 0) return criterion.direction === "ascending" ? compared : -compared;
    }
    return left.index - right.index;
  }).map(({ row }) => row);
}

export function matchesTableFilters(row: readonly string[], query: string, selectedValues: Record<number, readonly string[]>): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  if (normalizedQuery && !row.some((cell) => cell.toLocaleLowerCase("ja").includes(normalizedQuery))) return false;
  return Object.entries(selectedValues).every(([column, values]) => values.length === 0 || values.includes(row[Number(column)] ?? ""));
}

export function tableColumnValueCounts(rows: readonly (readonly string[])[], column: number, query = "", compare: (left: string, right: string) => number = (left, right) => left.localeCompare(right, "ja", { numeric: true })): Array<[string, number]> {
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = row[column] ?? "";
    if (normalizedQuery && !value.toLocaleLowerCase("ja").includes(normalizedQuery)) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return [...counts.entries()].sort(([left], [right]) => compare(left, right));
}
