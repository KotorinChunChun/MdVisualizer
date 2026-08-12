export type DelimitedTableLanguage = "csv" | "csv-h" | "tsv" | "tsv-h";

export interface DelimitedTableData {
  delimiter: "," | "\t";
  headers: string[];
  rows: string[][];
}

export function isDelimitedTableLanguage(language: string | undefined): language is DelimitedTableLanguage {
  return language !== undefined && ["csv", "csv-h", "tsv", "tsv-h"].includes(language.toLowerCase());
}

export function parseDelimitedTable(source: string, language: DelimitedTableLanguage): DelimitedTableData {
  const delimiter = language.startsWith("tsv") ? "\t" : ",";
  const parsedRows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const finishField = () => {
    row.push(field);
    field = "";
  };
  const finishRow = () => {
    finishField();
    if (row.some((cell) => cell.trim() !== "")) parsedRows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === delimiter) {
      finishField();
    } else if (character === "\n" || character === "\r") {
      finishRow();
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("引用符で囲まれたセルが閉じられていません。");
  if (field !== "" || row.length > 0) finishRow();

  const width = Math.max(1, ...parsedRows.map((candidate) => candidate.length));
  const normalized = parsedRows.map((candidate) => Array.from({ length: width }, (_, index) => candidate[index] ?? ""));
  const first = normalized.shift();
  const headers = first
    ? first.map((value, index) => value || `列 ${index + 1}`)
    : Array.from({ length: width }, (_, index) => `列 ${index + 1}`);
  return { delimiter, headers, rows: normalized };
}

function serializeCell(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function serializeDelimitedTable(data: Pick<DelimitedTableData, "delimiter" | "headers" | "rows">): string {
  return [data.headers, ...data.rows]
    .map((row) => row.map((cell) => serializeCell(String(cell ?? ""), data.delimiter)).join(data.delimiter))
    .join("\n");
}

export function compareDelimitedValues(left: string, right: string): number {
  const leftNumber = Number(left.replace(/,/g, ""));
  const rightNumber = Number(right.replace(/,/g, ""));
  if (left.trim() && right.trim() && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right, "ja", { numeric: true, sensitivity: "base" });
}
