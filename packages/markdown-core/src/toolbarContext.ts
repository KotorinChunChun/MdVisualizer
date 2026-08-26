export const MARKDOWN_BLOCK_INSERTION_ACTIONS = ["code-block", "table", "mermaid", "horizontal-rule", "drawio"] as const;

export type MarkdownBlockInsertionAction = typeof MARKDOWN_BLOCK_INSERTION_ACTIONS[number];
export type MarkdownInsertionContextKind = "plain" | "fenced-code" | "table" | "inline-code" | "link-or-image";

export interface MarkdownInsertionContext {
  position: number;
  disabled: boolean;
  kind: MarkdownInsertionContextKind;
  requiredClosure: string;
}

interface SourceLine {
  start: number;
  end: number;
  after: number;
  text: string;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\r" && source[index] !== "\n") continue;
    const endingLength = source[index] === "\r" && source[index + 1] === "\n" ? 2 : 1;
    lines.push({ start, end: index, after: index + endingLength, text: source.slice(start, index) });
    index += endingLength - 1;
    start = index + 1;
  }
  lines.push({ start, end: source.length, after: source.length, text: source.slice(start) });
  return lines;
}

function lineEnding(source: string): "\n" | "\r\n" | "\r" {
  return source.match(/\r\n|\r|\n/)?.[0] as "\n" | "\r\n" | "\r" | undefined ?? "\n";
}

function positionInside(position: number, start: number, after: number, sourceLength: number): boolean {
  return position >= start && (position < after || (after === sourceLength && position <= after));
}

function fencedCodeContext(source: string, position: number, lines: SourceLine[]): MarkdownInsertionContext | null {
  let opener: { start: number; marker: string } | null = null;
  for (const line of lines) {
    if (!opener) {
      const match = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!match) continue;
      if (match[1][0] === "`" && match[2].includes("`")) continue;
      opener = { start: line.start, marker: match[1] };
      continue;
    }
    const closing = line.text.match(/^ {0,3}(`+|~+)\s*$/)?.[1];
    if (!closing || closing[0] !== opener.marker[0] || closing.length < opener.marker.length) continue;
    if (positionInside(position, opener.start, line.after, source.length)) {
      return { position: line.after, disabled: false, kind: "fenced-code", requiredClosure: "" };
    }
    opener = null;
  }
  if (!opener || position < opener.start) return null;
  const ending = lineEnding(source);
  const prefix = source.length > 0 && !/[\r\n]$/.test(source) ? ending : "";
  return {
    position: source.length,
    disabled: false,
    kind: "fenced-code",
    requiredClosure: `${prefix}${opener.marker}${ending}`,
  };
}

function splitTableCells(text: string): string[] | null {
  let value = text.trim();
  if (!value.includes("|")) return null;
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "|" && (index === 0 || value[index - 1] !== "\\")) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += value[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function tableContext(source: string, position: number, lines: SourceLine[]): MarkdownInsertionContext | null {
  for (let delimiterIndex = 1; delimiterIndex < lines.length; delimiterIndex += 1) {
    const headerCells = splitTableCells(lines[delimiterIndex - 1].text);
    const delimiterCells = splitTableCells(lines[delimiterIndex].text);
    if (!headerCells || !delimiterCells || headerCells.length !== delimiterCells.length
      || !delimiterCells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    let lastIndex = delimiterIndex;
    while (lastIndex + 1 < lines.length && splitTableCells(lines[lastIndex + 1].text)) lastIndex += 1;
    const start = lines[delimiterIndex - 1].start;
    const after = lines[lastIndex].after;
    if (positionInside(position, start, after, source.length)) {
      return { position, disabled: true, kind: "table", requiredClosure: "" };
    }
  }
  return null;
}

function escaped(source: string, position: number): boolean {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function matchingDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (escaped(source, index)) continue;
    if (source[index] === open) depth += 1;
    else if (source[index] === close && --depth === 0) return index;
  }
  return -1;
}

function linkOrImageEnd(source: string, position: number): number | null {
  for (let index = 0; index < source.length; index += 1) {
    const image = source[index] === "!" && source[index + 1] === "[" && !escaped(source, index);
    const link = source[index] === "[" && source[index - 1] !== "!" && !escaped(source, index);
    if (!image && !link) continue;
    const bracket = image ? index + 1 : index;
    const labelEnd = matchingDelimiter(source, bracket, "[", "]");
    if (labelEnd < 0) continue;
    let syntaxEnd = -1;
    if (source[labelEnd + 1] === "(") syntaxEnd = matchingDelimiter(source, labelEnd + 1, "(", ")");
    else if (source[labelEnd + 1] === "[") syntaxEnd = matchingDelimiter(source, labelEnd + 1, "[", "]");
    if (syntaxEnd >= 0 && position >= index && position <= syntaxEnd) return syntaxEnd + 1;
    index = labelEnd;
  }
  return null;
}

function inlineCodeEnd(source: string, position: number, lines: SourceLine[]): number | null {
  const line = lines.find((candidate) => position >= candidate.start && position <= candidate.end);
  if (!line) return null;
  for (let index = line.start; index < line.end; index += 1) {
    if (source[index] !== "`" || escaped(source, index)) continue;
    let length = 1;
    while (source[index + length] === "`") length += 1;
    const marker = "`".repeat(length);
    const closing = source.indexOf(marker, index + length);
    if (closing < 0 || closing > line.end) break;
    if (position >= index && position <= closing + length - 1) return closing + length;
    index = closing + length - 1;
  }
  return null;
}

export function isMarkdownBlockInsertionAction(action: string): action is MarkdownBlockInsertionAction {
  return (MARKDOWN_BLOCK_INSERTION_ACTIONS as readonly string[]).includes(action);
}

export function resolveMarkdownInsertionContext(source: string, cursor: number): MarkdownInsertionContext {
  const position = Math.max(0, Math.min(cursor, source.length));
  const lines = sourceLines(source);
  const fence = fencedCodeContext(source, position, lines);
  if (fence) return fence;
  const table = tableContext(source, position, lines);
  if (table) return table;
  const inlineEnd = inlineCodeEnd(source, position, lines);
  if (inlineEnd !== null) return { position: inlineEnd, disabled: false, kind: "inline-code", requiredClosure: "" };
  const linkEnd = linkOrImageEnd(source, position);
  if (linkEnd !== null) return { position: linkEnd, disabled: false, kind: "link-or-image", requiredClosure: "" };
  return { position, disabled: false, kind: "plain", requiredClosure: "" };
}
