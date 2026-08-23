function clampLine(line: number, maximum: number): number {
  return Math.max(1, Math.min(maximum, Math.round(line)));
}

/** Returns the last Markdown line belonging to a preview block. */
export function previewSourceRangeEnd(sourceLines: readonly number[], startLine: number, contentLineCount: number): number {
  const start = clampLine(startLine, Math.max(1, contentLineCount));
  const next = [...new Set(sourceLines.filter(Number.isFinite).map((line) => Math.round(line)))]
    .sort((left, right) => left - right)
    .find((line) => line > start);
  return Math.max(start, Math.min(contentLineCount, next === undefined ? contentLineCount : next - 1));
}

/** Copies the original Markdown represented by one or more selected preview blocks. */
export function markdownForPreviewRange(content: string, sourceLines: readonly number[], firstLine: number, lastBlockLine = firstLine): string {
  const lines = content.split(/\r\n|\r|\n/);
  const start = clampLine(Math.min(firstLine, lastBlockLine), lines.length);
  const lastStart = clampLine(Math.max(firstLine, lastBlockLine), lines.length);
  const end = previewSourceRangeEnd(sourceLines, lastStart, lines.length);
  const newline = content.includes("\r\n") ? "\r\n" : content.includes("\r") ? "\r" : "\n";
  return lines.slice(start - 1, end).join(newline);
}
