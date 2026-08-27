import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { remarkObsidianImages } from "./remarkObsidianImages";
import { calculateTableAggregates } from "./tableAggregation";

type MarkdownPosition = {
  start?: { line?: number; offset?: number };
  end?: { line?: number; offset?: number };
};

type MarkdownNode = {
  type?: string;
  lang?: string | null;
  meta?: string | null;
  url?: string;
  alt?: string | null;
  value?: string;
  align?: Array<"left" | "center" | "right" | null>;
  position?: MarkdownPosition;
  children?: MarkdownNode[];
};

interface MarkdownOccurrenceBase {
  id: string;
  start: number;
  end: number;
  sourceLine: number;
  expected: string;
}

export interface CodeFenceOccurrence extends MarkdownOccurrenceBase {
  kind: "code-fence";
  language: string;
  meta: string;
  body: string;
  bodyStart: number;
  bodyEnd: number;
  opening: string;
  closing: string;
  continuationPrefix: string;
  lineEnding: "\n" | "\r\n" | "\r";
}

export interface ImageMarkdownOccurrence extends MarkdownOccurrenceBase {
  kind: "image";
  syntax: "markdown" | "html";
  source: string;
  caption: string;
}

export interface InlineSvgOccurrence extends MarkdownOccurrenceBase {
  kind: "inline-svg";
  svg: string;
}

export interface MarkdownTableOccurrence extends MarkdownOccurrenceBase {
  kind: "table";
  headers: string[];
  rows: string[][];
  alignments: Array<"left" | "center" | "right" | null>;
  lineEnding: "\n" | "\r\n" | "\r";
  continuationPrefix: string;
}

export type EditableMarkdownOccurrence = CodeFenceOccurrence | ImageMarkdownOccurrence | InlineSvgOccurrence | MarkdownTableOccurrence;

export class MarkdownOccurrenceConflictError extends Error {
  constructor() {
    super("編集中に対象のMarkdown要素が変更されたため、置換できませんでした。");
    this.name = "MarkdownOccurrenceConflictError";
  }
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkObsidianImages);
const htmlImagePattern = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
const htmlAltPattern = /\balt\s*=\s*(["'])(.*?)\1/i;
const inlineSvgPattern = /<svg\b[\s\S]*?<\/svg\s*>|<svg\b[^>]*\/>/gi;
const opaqueHtmlPattern = /^\s*<(?:!--|script\b|style\b|textarea\b|pre\b)/i;

function occurrenceId(kind: EditableMarkdownOccurrence["kind"], start: number, end: number): string {
  return `${kind}-${start}-${end}`;
}

function rangeFor(node: MarkdownNode): { start: number; end: number; sourceLine: number } | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined || start < 0 || end < start) return null;
  return { start, end, sourceLine: node.position?.start?.line ?? 1 };
}

function lineEndingOf(opening: string): CodeFenceOccurrence["lineEnding"] {
  if (opening.endsWith("\r\n")) return "\r\n";
  if (opening.endsWith("\r")) return "\r";
  return "\n";
}

function parseCodeFence(markdown: string, node: MarkdownNode): CodeFenceOccurrence | null {
  const range = rangeFor(node);
  if (!range) return null;
  const expected = markdown.slice(range.start, range.end);
  const openingMatch = /^( {0,3})(`{3,}|~{3,})[^\r\n]*(\r\n|\n|\r)/.exec(expected);
  if (!openingMatch) return null;

  const opening = openingMatch[0];
  const marker = openingMatch[2];
  const lastLf = expected.lastIndexOf("\n");
  const lastCr = expected.lastIndexOf("\r");
  const closingStart = Math.max(lastLf, lastCr) + 1;
  const closing = expected.slice(closingStart);
  const closingMatch = /^((?:[ \t]*>[ \t]?)*[ \t]{0,3})(`{3,}|~{3,})[ \t]*$/.exec(closing);
  if (!closingMatch || closingMatch[2][0] !== marker[0] || closingMatch[2].length < marker.length) return null;

  const separatorLength = expected.slice(0, closingStart).endsWith("\r\n") ? 2 : 1;
  const bodyEndRelative = Math.max(opening.length, closingStart - separatorLength);
  const body = node.value ?? expected.slice(opening.length, bodyEndRelative);
  return {
    kind: "code-fence",
    id: occurrenceId("code-fence", range.start, range.end),
    ...range,
    expected,
    language: (node.lang ?? "").toLowerCase(),
    meta: node.meta ?? "",
    body,
    bodyStart: range.start + opening.length,
    bodyEnd: range.start + bodyEndRelative,
    opening,
    closing,
    continuationPrefix: closingMatch[1],
    lineEnding: lineEndingOf(opening),
  };
}

function splitMarkdownTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (/(^|[^\\])\|\s*$/.test(source)) source = source.replace(/\|\s*$/, "");
  const cells: string[] = [];
  let cell = "";
  let backslashes = 0;
  for (const character of source) {
    if (character === "|" && backslashes % 2 === 0) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  cells.push(cell.trim());
  return cells;
}

function parseMarkdownTable(markdown: string, node: MarkdownNode): MarkdownTableOccurrence | null {
  const range = rangeFor(node);
  if (!range) return null;
  const expected = markdown.slice(range.start, range.end);
  const sourceLines = expected.split(/\r\n|\r|\n/);
  const continuationPrefix = /^(?:(?:[ \t]*>[ \t]?)+)/.exec(sourceLines[1] ?? "")?.[0] ?? "";
  const lines = sourceLines.map((line, index) => index > 0 && continuationPrefix && line.startsWith(continuationPrefix) ? line.slice(continuationPrefix.length) : line);
  if (lines.length < 2) return null;
  const parsedRows = lines.map(splitMarkdownTableRow);
  const columnCount = Math.max(1, node.align?.length ?? 0, ...parsedRows.map((row) => row.length));
  const normalize = (row: string[]) => Array.from({ length: columnCount }, (_, column) => row[column] ?? "");
  return {
    kind: "table",
    id: occurrenceId("table", range.start, range.end),
    ...range,
    expected,
    headers: normalize(parsedRows[0]),
    rows: parsedRows.slice(2).map(normalize),
    alignments: Array.from({ length: columnCount }, (_, column) => node.align?.[column] ?? null),
    lineEnding: expected.includes("\r\n") ? "\r\n" : expected.includes("\r") ? "\r" : "\n",
    continuationPrefix,
  };
}

function encodeMarkdownTableCell(value: string): string {
  return value.trim().replace(/\r\n|\r|\n/g, "<br>").replace(/(^|[^\\])\|/g, "$1\\|");
}

export function serializeMarkdownTable(table: Pick<MarkdownTableOccurrence, "headers" | "rows" | "alignments" | "lineEnding"> & { continuationPrefix?: string }): string {
  const calculated = calculateTableAggregates(table);
  const width = Math.max(1, calculated.headers.length);
  const row = (values: string[]) => `| ${Array.from({ length: width }, (_, column) => encodeMarkdownTableCell(values[column] ?? "")).join(" | ")} |`;
  const separator = row(Array.from({ length: width }, (_, column) => {
    const alignment = table.alignments[column] ?? null;
    return alignment === "left" ? ":---" : alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---";
  }));
  return [row(calculated.headers), separator, ...calculated.rows.map(row)].map((line, index) => `${index > 0 ? table.continuationPrefix ?? "" : ""}${line}`).join(table.lineEnding);
}

function collectHtmlImages(node: MarkdownNode): ImageMarkdownOccurrence[] {
  const range = rangeFor(node);
  if (!range || !node.value) return [];
  const occurrences: ImageMarkdownOccurrence[] = [];
  for (const match of node.value.matchAll(htmlImagePattern)) {
    const relativeStart = match.index ?? 0;
    const expected = match[0];
    const start = range.start + relativeStart;
    const end = start + expected.length;
    occurrences.push({
      kind: "image",
      syntax: "html",
      id: occurrenceId("image", start, end),
      start,
      end,
      sourceLine: range.sourceLine + node.value.slice(0, relativeStart).split(/\r\n|\r|\n/).length - 1,
      expected,
      source: match[2],
      caption: htmlAltPattern.exec(expected)?.[2] ?? "",
    });
  }
  return occurrences;
}

export function collectEditableMarkdownOccurrences(markdown: string): EditableMarkdownOccurrence[] {
  const root = parser.runSync(parser.parse(markdown)) as MarkdownNode;
  const occurrences: EditableMarkdownOccurrence[] = [];
  const protectedRanges: Array<{ start: number; end: number }> = [];

  const visit = (node: MarkdownNode) => {
    if (node.type === "code") {
      const range = rangeFor(node);
      if (range) protectedRanges.push(range);
      const occurrence = parseCodeFence(markdown, node);
      if (occurrence) occurrences.push(occurrence);
    } else if (node.type === "table") {
      const occurrence = parseMarkdownTable(markdown, node);
      if (occurrence) occurrences.push(occurrence);
    } else if (node.type === "inlineCode") {
      const range = rangeFor(node);
      if (range) protectedRanges.push(range);
    } else if (node.type === "image" && node.url) {
      const range = rangeFor(node);
      if (range) {
        occurrences.push({
          kind: "image",
          syntax: "markdown",
          id: occurrenceId("image", range.start, range.end),
          ...range,
          expected: markdown.slice(range.start, range.end),
          source: node.url,
          caption: node.alt ?? "",
        });
      }
    } else if (node.type === "html") {
      const range = rangeFor(node);
      if (range && opaqueHtmlPattern.test(node.value ?? "")) protectedRanges.push(range);
      else occurrences.push(...collectHtmlImages(node));
    }
    node.children?.forEach(visit);
  };

  visit(root);
  for (const match of markdown.matchAll(inlineSvgPattern)) {
    const start = match.index ?? 0;
    const expected = match[0];
    const end = start + expected.length;
    if (protectedRanges.some((range) => start < range.end && end > range.start)) continue;
    occurrences.push({
      kind: "inline-svg",
      id: occurrenceId("inline-svg", start, end),
      start,
      end,
      sourceLine: markdown.slice(0, start).split(/\r\n|\r|\n/).length,
      expected,
      svg: expected,
    });
  }
  return occurrences.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function replaceMarkdownOccurrence(markdown: string, occurrence: EditableMarkdownOccurrence, replacement: string): string {
  if (
    occurrence.start < 0
    || occurrence.end < occurrence.start
    || occurrence.end > markdown.length
    || markdown.slice(occurrence.start, occurrence.end) !== occurrence.expected
  ) {
    throw new MarkdownOccurrenceConflictError();
  }
  return `${markdown.slice(0, occurrence.start)}${replacement}${markdown.slice(occurrence.end)}`;
}

export function replaceCodeFenceBody(markdown: string, occurrence: CodeFenceOccurrence, body: string): string {
  const normalized = body.replace(/\r\n|\r|\n/g, occurrence.lineEnding).replace(/(?:\r\n|\r|\n)$/, "");
  const encoded = normalized
    ? normalized.split(occurrence.lineEnding).map((line) => `${occurrence.continuationPrefix}${line}`).join(occurrence.lineEnding)
    : "";
  const replacement = `${occurrence.opening}${encoded}${encoded ? occurrence.lineEnding : ""}${occurrence.closing}`;
  return replaceMarkdownOccurrence(markdown, occurrence, replacement);
}
