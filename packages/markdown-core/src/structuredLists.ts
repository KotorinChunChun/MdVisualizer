import type { MarkdownEditChange } from "./index";
import { normalizeNumberedHeadings } from "./structuredHeadings";

export type StructuredListKind = "unordered" | "ordered" | "task-unchecked" | "task-checked";

export interface MarkdownListLine {
  indent: string;
  indentWidth: number;
  marker: string;
  ordered: boolean;
  task: "checked" | "unchecked" | null;
  body: string;
  prefixLength: number;
}

interface DocumentLine {
  text: string;
  ending: string;
  start: number;
  inFence: boolean;
  list: MarkdownListLine | null;
}

function indentationWidth(indent: string): number {
  let width = 0;
  for (const character of indent) width += character === "\t" ? 4 - (width % 4) : 1;
  return width;
}

export function parseMarkdownListLine(text: string): MarkdownListLine | null {
  const match = /^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(text);
  if (!match) return null;
  const markerEnd = match[1].length + match[2].length + 1;
  const taskLength = match[3] === undefined ? 0 : 4;
  return {
    indent: match[1],
    indentWidth: indentationWidth(match[1]),
    marker: match[2],
    ordered: /^\d/.test(match[2]),
    task: match[3] === undefined ? null : match[3].toLowerCase() === "x" ? "checked" : "unchecked",
    body: match[4],
    prefixLength: markerEnd + taskLength,
  };
}

function documentLines(source: string): DocumentLine[] {
  const lines: DocumentLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let start = 0;
  let fence: { marker: "`" | "~"; length: number } | null = null;
  while (start < source.length || (start === 0 && source.length === 0)) {
    pattern.lastIndex = start;
    const match = pattern.exec(source);
    if (!match) break;
    const text = match[1];
    const ending = match[2];
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    const closing = fence && new RegExp(`^ {0,3}${fence.marker === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(text);
    const inFence = fence !== null || opening !== undefined;
    lines.push({ text, ending, start, inFence, list: inFence ? null : parseMarkdownListLine(text) });
    if (closing) fence = null;
    else if (!fence && opening) fence = { marker: opening[0] as "`" | "~", length: opening.length };
    start = pattern.lastIndex;
    if (!ending || start >= source.length) break;
  }
  return lines;
}

function joinLines(lines: DocumentLine[]): string {
  return lines.map((line) => line.text + line.ending).join("");
}

function renumberLines(lines: DocumentLine[]): void {
  const counters = new Map<number, number>();
  for (const line of lines) {
    const item = line.inFence ? null : parseMarkdownListLine(line.text);
    line.list = item;
    if (!item) {
      const continuationIndent = indentationWidth(line.text.match(/^\s*/)?.[0] ?? "");
      const shallowestListIndent = counters.size ? Math.min(...counters.keys()) : Number.POSITIVE_INFINITY;
      if (line.text.trim() === "" || continuationIndent <= shallowestListIndent) counters.clear();
      continue;
    }
    for (const level of Array.from(counters.keys())) {
      if (level > item.indentWidth) counters.delete(level);
    }
    if (!item.ordered) {
      counters.delete(item.indentWidth);
      continue;
    }
    const number = (counters.get(item.indentWidth) ?? 0) + 1;
    counters.set(item.indentWidth, number);
    const suffix = item.marker.endsWith(")") ? ")" : ".";
    line.text = `${item.indent}${number}${suffix} ${item.task ? `[${item.task === "checked" ? "x" : " "}] ` : ""}${item.body}`;
    line.list = parseMarkdownListLine(line.text);
  }
}

export function renumberOrderedLists(source: string): string {
  const lines = documentLines(source);
  renumberLines(lines);
  return joinLines(lines);
}

/**
 * Converts the editor's compact list indentation to an equal-length tab form for
 * CommonMark parsing. Keeping every line and offset the same lets renderers
 * continue to map images, code fences, and diff lines back to the source.
 */
export function normalizeStructuredListIndentationForRendering(source: string): string {
  const lines = documentLines(source);
  let activeListBlock = false;
  let rootIndent = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    if (line.inFence) continue;
    const item = line.list;
    if (item) {
      if (!activeListBlock) {
        if (item.indentWidth > 3) continue;
        activeListBlock = true;
        rootIndent = item.indentWidth;
      } else {
        rootIndent = Math.min(rootIndent, item.indentWidth);
      }
      if (item.indent.length >= 2 && /^ +$/.test(item.indent)) {
        const normalizedIndent = "\t ".repeat(Math.floor(item.indent.length / 2))
          + (item.indent.length % 2 === 0 ? "" : "\t");
        line.text = normalizedIndent + line.text.slice(item.indent.length);
      }
      continue;
    }

    if (line.text.trim() === "") continue;
    const continuationIndent = indentationWidth(line.text.match(/^\s*/)?.[0] ?? "");
    if (continuationIndent <= rootIndent) {
      activeListBlock = false;
      rootIndent = Number.POSITIVE_INFINITY;
    }
  }

  return joinLines(lines);
}

export function buildOrderedListNormalization(source: string, anchor: number, head = anchor): MarkdownEditChange | null {
  const after = normalizeNumberedHeadings(renumberOrderedLists(source));
  if (after === source) return null;
  return minimalChange(source, after, mapPosition(source, after, anchor), mapPosition(source, after, head));
}

function lineIndexAt(lines: DocumentLine[], position: number): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (position >= lines[index].start) return index;
  }
  return 0;
}

function mapColumn(before: string, after: string, column: number): number {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  if (column <= prefix) return column;
  if (column >= before.length - suffix) return Math.max(prefix, after.length - (before.length - column));
  return Math.min(after.length - suffix, prefix + Math.max(0, after.length - prefix - suffix));
}

function mapPosition(before: string, after: string, position: number): number {
  const beforeLines = documentLines(before);
  const afterLines = documentLines(after);
  const index = Math.min(lineIndexAt(beforeLines, position), afterLines.length - 1);
  const column = Math.min(beforeLines[index].text.length, position - beforeLines[index].start);
  return afterLines[index].start + mapColumn(beforeLines[index].text, afterLines[index].text, column);
}

function minimalChange(before: string, after: string, anchor: number, head = anchor): MarkdownEditChange {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return {
    from: prefix,
    to: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
    anchor,
    head,
  };
}

function targetLineRange(lines: DocumentLine[], from: number, to: number): [number, number] {
  const first = lineIndexAt(lines, from);
  const last = lineIndexAt(lines, to > from ? to - 1 : to);
  return [first, last];
}

function targetMatches(item: MarkdownListLine | null, kind: StructuredListKind): boolean {
  if (!item) return false;
  if (kind === "unordered") return !item.ordered && item.task === null;
  if (kind === "ordered") return item.ordered && item.task === null;
  return item.task === (kind === "task-checked" ? "checked" : "unchecked");
}

function toggleLine(line: DocumentLine, kind: StructuredListKind, remove: boolean): void {
  const item = line.list;
  if (line.inFence || line.text.trim() === "") return;
  if (remove && item) {
    line.text = `${item.indent}${item.body}`;
    return;
  }
  const indent = item?.indent ?? line.text.match(/^\s*/)?.[0] ?? "";
  const body = item?.body ?? line.text.slice(indent.length);
  if (kind === "unordered") line.text = `${indent}- ${body}`;
  else if (kind === "ordered") line.text = `${indent}1. ${body}`;
  else line.text = `${indent}- [${kind === "task-checked" ? "x" : " "}] ${body}`;
}

export function buildStructuredListToggle(source: string, from: number, to: number, kind: StructuredListKind): MarkdownEditChange | null {
  const lines = documentLines(source);
  const [first, last] = targetLineRange(lines, from, to);
  const targets = lines.slice(first, last + 1).filter((line) => !line.inFence && line.text.trim() !== "");
  if (!targets.length) return null;
  const remove = targets.every((line) => targetMatches(line.list, kind));
  for (let index = first; index <= last; index += 1) toggleLine(lines[index], kind, remove);
  renumberLines(lines);
  const after = joinLines(lines);
  const anchor = mapPosition(source, after, from);
  const head = mapPosition(source, after, to);
  return minimalChange(source, after, anchor, head);
}

function applyAndRenumber(source: string, intermediate: string, anchor: number, head = anchor): MarkdownEditChange {
  const after = renumberOrderedLists(intermediate);
  return minimalChange(source, after, mapPosition(intermediate, after, anchor), mapPosition(intermediate, after, head));
}

export function buildStructuredListEnter(source: string, from: number, to: number): MarkdownEditChange | null {
  if (from !== to) return null;
  const lines = documentLines(source);
  const index = lineIndexAt(lines, from);
  const line = lines[index];
  const item = line.list;
  if (!item || line.inFence) return null;
  if (item.body.trim() === "") {
    const after = source.slice(0, line.start) + item.indent + source.slice(line.start + line.text.length);
    return applyAndRenumber(source, after, line.start + item.indent.length);
  }
  const ending = line.ending || (source.includes("\r\n") ? "\r\n" : "\n");
  const column = Math.max(item.prefixLength, from - line.start);
  const beforeCursor = line.text.slice(0, column);
  const afterCursor = line.text.slice(column);
  const marker = item.ordered ? `${Number.parseInt(item.marker, 10) + 1}${item.marker.endsWith(")") ? ")" : "."}` : item.marker;
  const task = item.task ? `[ ] ` : "";
  const insertedLine = `${item.indent}${marker} ${task}`;
  const replacement = `${beforeCursor}${ending}${insertedLine}${afterCursor}`;
  const intermediate = source.slice(0, line.start) + replacement + source.slice(line.start + line.text.length + line.ending.length);
  return applyAndRenumber(source, intermediate, line.start + beforeCursor.length + ending.length + insertedLine.length);
}

export function buildStructuredListSoftEnter(source: string, from: number, to: number): MarkdownEditChange | null {
  if (from !== to) return null;
  const lines = documentLines(source);
  const line = lines[lineIndexAt(lines, from)];
  const item = line.list;
  if (!item || line.inFence) return null;
  const ending = line.ending || (source.includes("\r\n") ? "\r\n" : "\n");
  const column = Math.max(item.prefixLength, from - line.start);
  const beforeCursor = line.text.slice(0, column);
  const afterCursor = line.text.slice(column);
  const continuationIndent = `${item.indent}  `;
  const replacement = `${beforeCursor}${ending}${continuationIndent}${afterCursor}`;
  const insertTo = line.start + line.text.length + line.ending.length;
  return minimalChange(
    source,
    source.slice(0, line.start) + replacement + source.slice(insertTo),
    line.start + beforeCursor.length + ending.length + continuationIndent.length,
  );
}

export function buildStructuredListIndent(source: string, from: number, to: number, outdent = false): MarkdownEditChange | null {
  const lines = documentLines(source);
  const [first, last] = targetLineRange(lines, from, to);
  if (!lines.slice(first, last + 1).some((line) => line.list && !line.inFence)) return null;
  for (let index = first; index <= last; index += 1) {
    const line = lines[index];
    if (line.inFence || !line.list) continue;
    if (outdent) line.text = line.text.startsWith("\t") ? line.text.slice(1) : line.text.replace(/^ {1,2}/, "");
    else line.text = `  ${line.text}`;
  }
  renumberLines(lines);
  const after = joinLines(lines);
  return minimalChange(source, after, mapPosition(source, after, from), mapPosition(source, after, to));
}

export function buildStructuredListPaste(source: string, from: number, to: number, pasted: string): MarkdownEditChange | null {
  if (from !== to) return null;
  const lines = documentLines(source);
  const line = lines[lineIndexAt(lines, from)];
  const item = line.list;
  const pastedLines = pasted.replace(/\r\n|\r/g, "\n").split("\n");
  if (!item || item.body.trim() !== "" || !parseMarkdownListLine(pastedLines[0])) return null;
  const ending = line.ending || (source.includes("\r\n") ? "\r\n" : "\n");
  const replacement = pastedLines.map((value) => item.indent + value).join(ending);
  const intermediate = source.slice(0, line.start) + replacement + source.slice(line.start + line.text.length);
  return applyAndRenumber(source, intermediate, line.start + replacement.length);
}

function itemEnd(lines: DocumentLine[], index: number): number {
  const level = lines[index].list!.indentWidth;
  let cursor = index + 1;
  while (cursor < lines.length) {
    const item = lines[cursor].list;
    if (item && item.indentWidth <= level) break;
    if (!item && lines[cursor].text.trim() !== "") break;
    cursor += 1;
  }
  return cursor;
}

export function buildStructuredListMove(source: string, position: number, direction: -1 | 1): MarkdownEditChange | null {
  const lines = documentLines(source);
  const index = lineIndexAt(lines, position);
  const item = lines[index].list;
  if (!item || lines[index].inFence) return null;
  const currentEndIndex = itemEnd(lines, index);
  const currentStart = lines[index].start;
  const currentEnd = lines[currentEndIndex]?.start ?? source.length;
  let intermediate: string;
  let movedPosition: number;
  if (direction < 0) {
    let previous = index - 1;
    while (previous >= 0 && lines[previous].list?.indentWidth !== item.indentWidth) {
      if (lines[previous].list && lines[previous].list!.indentWidth < item.indentWidth) return null;
      previous -= 1;
    }
    if (previous < 0 || !lines[previous].list) return null;
    const previousStart = lines[previous].start;
    const previousBlock = source.slice(previousStart, currentStart);
    const currentBlock = source.slice(currentStart, currentEnd);
    intermediate = source.slice(0, previousStart) + currentBlock + previousBlock + source.slice(currentEnd);
    movedPosition = previousStart + (position - currentStart);
  } else {
    const next = currentEndIndex;
    if (next >= lines.length || lines[next].list?.indentWidth !== item.indentWidth) return null;
    const nextEndIndex = itemEnd(lines, next);
    const nextEnd = lines[nextEndIndex]?.start ?? source.length;
    const currentBlock = source.slice(currentStart, currentEnd);
    const nextBlock = source.slice(currentEnd, nextEnd);
    intermediate = source.slice(0, currentStart) + nextBlock + currentBlock + source.slice(nextEnd);
    movedPosition = currentStart + nextBlock.length + (position - currentStart);
  }
  return applyAndRenumber(source, intermediate, movedPosition);
}
